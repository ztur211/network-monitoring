import type { AgentDeviceDto } from '@nodescope/shared';
import type { SnmpTargetDto } from '@nodescope/shared';
import type { CollectResult, Collector } from '../poller.js';

/** A minimal SNMP session abstraction used by snmpCollector (real or fake). */
export interface SnmpSession {
  /** GET a set of OIDs; returns a map of oid→value. */
  get(oids: string[]): Promise<Record<string, unknown>>;
  /** Walk a single column OID; returns a map of ifIndex (as string) → value. */
  walkColumn(oid: string): Promise<Record<string, unknown>>;
  /** Release underlying socket / session resources. */
  close(): void;
}

/**
 * Factory that produces an SnmpSession for a given target descriptor.
 * `host` is the device IP address to connect to.
 */
export type SnmpSessionFactory = (target: SnmpTargetDto, host: string) => SnmpSession;

// ---------------------------------------------------------------------------
// Standard OID constants
// ---------------------------------------------------------------------------

/** SNMPv2-MIB::sysUpTime.0 — in hundredths of a second. */
export const SYS_UPTIME = '1.3.6.1.2.1.1.3.0';

/** IF-MIB::ifHCInOctets (64-bit column) — ifXTable column 6. */
export const IF_HC_IN_OCTETS = '1.3.6.1.2.1.31.1.1.1.6';

/** IF-MIB::ifHCOutOctets (64-bit column) — ifXTable column 10. */
export const IF_HC_OUT_OCTETS = '1.3.6.1.2.1.31.1.1.1.10';

/** IF-MIB::ifOperStatus (ifTable column 8). */
export const IF_OPER_STATUS = '1.3.6.1.2.1.2.2.1.8';

// ---------------------------------------------------------------------------
// Collector implementation
// ---------------------------------------------------------------------------

/**
 * Returns a Collector that, for each device that has an SNMP target descriptor
 * (`device.snmp`), opens an SNMP session via the provided factory and:
 *  - GETs sysUpTime → emits `sys_uptime` (value in seconds, i.e. ticks / 100)
 *  - GETs each OID listed in `device.snmp.oids` → emits one metric per entry
 *    using the entry's `metric` label as the metric name
 *  - If `device.snmp.interfaceMetrics` is true, walks ifHCInOctets,
 *    ifHCOutOctets and ifOperStatus and emits per-ifIndex metrics
 *    (`if_hc_in_octets.<idx>`, `if_hc_out_octets.<idx>`, `if_oper_status.<idx>`)
 *
 * Devices without a `snmp` field are silently skipped.
 * Any per-device SNMP error returns `{ checks: [], metrics: [] }` without
 * rethrowing; the session is always closed via a finally block.
 */
export function snmpCollector(factory: SnmpSessionFactory): Collector {
  return {
    async collect(device: AgentDeviceDto): Promise<CollectResult> {
      // No SNMP configured for this device — skip it entirely.
      if (!device.snmp) {
        return { checks: [], metrics: [] };
      }

      const target = device.snmp;
      let session: SnmpSession | undefined;

      try {
        session = factory(target, device.ipAddress);
        const metrics: Array<{ deviceId: string; metric: string; value: number }> = [];

        // --- sysUpTime scalar GET ---
        const scalarOids: string[] = [SYS_UPTIME];
        // Add custom OIDs for the bulk GET
        for (const entry of target.oids) {
          scalarOids.push(entry.oid);
        }

        const scalarResult = await session.get(scalarOids);

        // sysUpTime in hundredths of seconds → convert to seconds
        const rawUptime = scalarResult[SYS_UPTIME];
        if (rawUptime != null) {
          metrics.push({ deviceId: device.id, metric: 'sys_uptime', value: Number(rawUptime) / 100 });
        }

        // Custom OID entries
        for (const entry of target.oids) {
          const raw = scalarResult[entry.oid];
          if (raw != null) {
            metrics.push({ deviceId: device.id, metric: entry.metric, value: Number(raw) });
          }
        }

        // --- Interface metrics (ifXTable + ifOperStatus) ---
        if (target.interfaceMetrics) {
          const [inOctets, outOctets, operStatus] = await Promise.all([
            session.walkColumn(IF_HC_IN_OCTETS),
            session.walkColumn(IF_HC_OUT_OCTETS),
            session.walkColumn(IF_OPER_STATUS),
          ]);

          for (const [idx, raw] of Object.entries(inOctets)) {
            metrics.push({ deviceId: device.id, metric: `if_hc_in_octets.${idx}`, value: Number(raw) });
          }

          for (const [idx, raw] of Object.entries(outOctets)) {
            metrics.push({ deviceId: device.id, metric: `if_hc_out_octets.${idx}`, value: Number(raw) });
          }

          for (const [idx, raw] of Object.entries(operStatus)) {
            metrics.push({ deviceId: device.id, metric: `if_oper_status.${idx}`, value: Number(raw) });
          }
        }

        return { checks: [], metrics };
      } catch {
        // Per-device SNMP error: return empty result, never throw
        return { checks: [], metrics: [] };
      } finally {
        session?.close();
      }
    },
  };
}
