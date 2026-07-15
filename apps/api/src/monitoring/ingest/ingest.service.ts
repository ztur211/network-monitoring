import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DeviceStatusState } from '@prisma/client';
import { mapLimit } from '@nodescope/shared';
import { StatusCheckDto, MetricSampleDto } from '@nodescope/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MonitoringRepository } from '../monitoring.repository';
import { deriveState } from '../status/derive-state';
import { NodeScopeException } from '../../common/filters/global-exception.filter';

export const MONITORING_EMITTER = Symbol('MONITORING_EMITTER');

/**
 * Max deviceStatus upserts in flight for one ingest batch.
 *
 * The metric and event rows go out as single multi-row INSERTs, but the status upserts are
 * inherently one statement per device. `Promise.all` over them fired one query per CHECK with no
 * bound: a batch at the endpoint's cap (1000 checks) meant 1000 concurrent queries against a
 * Prisma pool whose default size is num_cpus*2+1 (typically 9-17) and which is SHARED with every
 * other request and background job. The fan-out is the outage: it doesn't just make this one
 * request slow, it starves the pool so unrelated requests start failing on pool timeouts.
 *
 * 8 stays comfortably inside even a small default pool while keeping the DB pipelined, so a full
 * batch costs ~125 sequential round-trips instead of one 1000-wide thundering herd.
 */
const STATUS_UPSERT_CONCURRENCY = 8;

type StatusUpsert = Parameters<MonitoringRepository['upsertStatus']>[0];

export interface DeviceStatusEmit {
  organizationId: string;
  deviceId: string;
  governingSiteId: string;
  state: string;
  latencyMs: number | null;
  at: string;
}

/** Port over the realtime gateway's F3-scoped device-event emit (bound in Phase B). */
export interface MonitoringEmitter {
  emitDeviceStatus(payload: DeviceStatusEmit): void;
}

const cfg = () => ({
  downThreshold: Number(process.env.MONITORING_DOWN_THRESHOLD ?? 3),
  warnLatencyMs: Number(process.env.MONITORING_WARN_LATENCY_MS ?? 250),
});

/**
 * The single monitoring write path: the embedded prober and the HTTP ingest
 * controller both call it. Derives state, persists current status + a metric
 * sample, and on a state transition appends a status event and emits realtime.
 */
@Injectable()
export class IngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: MonitoringRepository,
    @Inject(MONITORING_EMITTER) private readonly emitter: MonitoringEmitter,
  ) {}

  /** Validates the device belongs to the org; a foreign-org device is invisible (ORG_008/404). */
  private async device(organizationId: string, deviceId: string) {
    const d = await this.prisma.device.findFirst({
      where: { id: deviceId, organizationId },
      select: { id: true, propertyId: true },
    });
    if (!d) {
      throw new NodeScopeException('ORG_008', 'CROSS_ORG_ACCESS_DENIED', HttpStatus.NOT_FOUND);
    }
    return d;
  }

  async reportStatusCheck(input: {
    organizationId: string;
    deviceId: string;
    ok: boolean;
    latencyMs?: number;
    source: string;
    checkedAt?: Date;
  }): Promise<void> {
    const dev = await this.device(input.organizationId, input.deviceId);
    const prev = await this.repo.getStatus(input.organizationId, input.deviceId);
    const { state, consecutiveFails } = deriveState(
      { consecutiveFails: prev?.consecutiveFails ?? 0 },
      { ok: input.ok, latencyMs: input.latencyMs },
      cfg(),
    );
    const changed = prev?.state !== state;
    await this.repo.upsertStatus({
      organizationId: input.organizationId,
      deviceId: input.deviceId,
      state,
      latencyMs: input.latencyMs ?? null,
      consecutiveFails,
      source: input.source,
      ok: input.ok,
      changed,
    });
    if (input.latencyMs != null) {
      await this.repo.insertMetric({
        organizationId: input.organizationId,
        deviceId: input.deviceId,
        metric: 'latency_ms',
        value: input.latencyMs,
        source: input.source,
        ts: input.checkedAt,
      });
    }
    await this.repo.insertMetric({
      organizationId: input.organizationId,
      deviceId: input.deviceId,
      metric: 'reachable',
      value: input.ok ? 1 : 0,
      source: input.source,
      ts: input.checkedAt,
    });
    if (changed) {
      await this.repo.insertStatusEvent({
        organizationId: input.organizationId,
        deviceId: input.deviceId,
        state,
        source: input.source,
      });
      this.emitter.emitDeviceStatus({
        organizationId: input.organizationId,
        deviceId: input.deviceId,
        governingSiteId: dev.propertyId,
        state,
        latencyMs: input.latencyMs ?? null,
        at: new Date().toISOString(),
      });
    }
  }

  async reportMetric(input: {
    organizationId: string;
    deviceId: string;
    metric: string;
    value: number;
    source: string;
    ts?: Date;
  }): Promise<void> {
    await this.device(input.organizationId, input.deviceId);
    await this.repo.insertMetric(input);
  }

  /**
   * Set-based ingest for an HTTP batch (the agent path). Same semantics as N calls to
   * reportStatusCheck/reportMetric, but the per-device serial round-trips (device lookup,
   * getStatus, upsert, 2 metric inserts) collapse to: one device-ownership findMany, one
   * bulk prior-status fetch, one multi-row metric INSERT, one multi-row event INSERT, and
   * the status upserts run with a bounded concurrency (STATUS_UPSERT_CONCURRENCY). A foreign-org
   * device fails the whole batch with ORG_008 before any write (atomic) - same reject contract,
   * no partial writes.
   *
   * The caller (IngestBatchSizeGuard) has already bounded `checks`/`metrics` to the endpoint's
   * per-batch caps, so the work here is bounded per request as well as per query.
   */
  async ingestBatch(
    organizationId: string,
    checks: StatusCheckDto[],
    metrics: MetricSampleDto[],
    sourceOverride: string | undefined,
  ): Promise<void> {
    const deviceIds = [...new Set([...checks.map((c) => c.deviceId), ...metrics.map((m) => m.deviceId)])];
    if (deviceIds.length === 0) return;

    const owned = await this.prisma.device.findMany({
      where: { id: { in: deviceIds }, organizationId },
      select: { id: true, propertyId: true },
    });
    const propertyByDevice = new Map(owned.map((d) => [d.id, d.propertyId]));
    for (const id of deviceIds) {
      if (!propertyByDevice.has(id)) {
        throw new NodeScopeException('ORG_008', 'CROSS_ORG_ACCESS_DENIED', HttpStatus.NOT_FOUND);
      }
    }

    const checkDeviceIds = [...new Set(checks.map((c) => c.deviceId))];
    const prev = checkDeviceIds.length ? await this.repo.listStatus(organizationId, checkDeviceIds) : [];
    const prevByDevice = new Map(prev.map((s) => [s.deviceId, s]));

    const thresholds = cfg();
    const metricRows: { organizationId: string; deviceId: string; metric: string; value: number; source: string; ts?: Date }[] = [];
    const eventRows: { organizationId: string; deviceId: string; state: DeviceStatusState; source: string }[] = [];
    const emits: DeviceStatusEmit[] = [];
    // Collect upsert INPUTS, not promises: pushing `this.repo.upsertStatus(...)` into an array
    // starts the query immediately, so the fan-out would already have happened by the time we
    // reached the bounded runner below.
    const statusUpserts: StatusUpsert[] = [];

    for (const c of checks) {
      const source = sourceOverride ?? c.source ?? 'agent';
      const before = prevByDevice.get(c.deviceId);
      const { state, consecutiveFails } = deriveState(
        { consecutiveFails: before?.consecutiveFails ?? 0 },
        { ok: c.ok, latencyMs: c.latencyMs },
        thresholds,
      );
      const changed = before?.state !== state;
      statusUpserts.push({
        organizationId, deviceId: c.deviceId, state, latencyMs: c.latencyMs ?? null,
        consecutiveFails, source, ok: c.ok, changed,
      });
      if (c.latencyMs != null) {
        metricRows.push({ organizationId, deviceId: c.deviceId, metric: 'latency_ms', value: c.latencyMs, source });
      }
      metricRows.push({ organizationId, deviceId: c.deviceId, metric: 'reachable', value: c.ok ? 1 : 0, source });
      if (changed) {
        eventRows.push({ organizationId, deviceId: c.deviceId, state, source });
        emits.push({
          organizationId, deviceId: c.deviceId, governingSiteId: propertyByDevice.get(c.deviceId)!,
          state, latencyMs: c.latencyMs ?? null, at: new Date().toISOString(),
        });
      }
    }

    for (const m of metrics) {
      const source = sourceOverride ?? m.source ?? 'agent';
      metricRows.push({
        organizationId, deviceId: m.deviceId, metric: m.metric, value: m.value, source,
        ts: m.ts ? new Date(m.ts) : undefined,
      });
    }

    await Promise.all([
      mapLimit(statusUpserts, STATUS_UPSERT_CONCURRENCY, (u) => this.repo.upsertStatus(u)),
      this.repo.insertMetrics(metricRows),
      this.repo.insertStatusEvents(eventRows),
    ]);

    for (const e of emits) this.emitter.emitDeviceStatus(e);
  }
}
