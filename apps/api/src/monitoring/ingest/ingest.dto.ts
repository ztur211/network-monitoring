import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type {
  IngestBatchDto as IngestBatchShape,
  MetricSampleDto as MetricSampleShape,
  StatusCheckDto as StatusCheckShape,
} from '@nodescope/shared';

/**
 * Validation for POST /v1/monitoring/ingest.
 *
 * These are API-local CLASSES, deliberately not the `@nodescope/shared` interfaces: the global
 * ValidationPipe only validates a parameter whose metatype is a class, so a body typed as an
 * interface has a metatype of `Object` and is waved through UNVALIDATED. Each class `implements`
 * its shared counterpart, so the wire shape is identical by construction - if the shared interface
 * ever changes, this file fails to compile rather than silently drifting. packages/shared stays
 * framework-free (no class-validator dependency).
 *
 * ---------------------------------------------------------------------------
 * The caps, and why they are these numbers
 * ---------------------------------------------------------------------------
 * Before this file existed, the endpoint had NO validation whatsoever, and body-parser's silent
 * 100 kB DEFAULT was the only thing bounding it. The agent sends one batch per poll cycle
 * containing every device, so at roughly 130 bytes/device a fleet crossed 100 kB at ~800 devices,
 * the API answered 413, and the agent's buffer treated that 4xx as permanent and DROPPED the
 * batch. Monitoring data was destroyed, not delayed. Two rules keep that from recurring:
 *
 * 1. The ITEM cap must bind before the BYTE cap, so a rejection is deterministic and explains
 *    itself. Worst case (every optional field present and maxed) a check serializes to ~170 B and
 *    a metric to ~290 B, so a batch at both caps is ~460 kB - comfortably inside INGEST_BODY_LIMIT
 *    even before gzip. A batch that respects the item caps therefore CANNOT trip the byte limit;
 *    the only way to get a 413 is to exceed a cap the client is told about (see rule 2).
 *
 * 2. Every over-cap rejection is a 413, never a 400 (see IngestBatchSizeGuard), and the agent
 *    treats 413 as "split and retry" rather than "drop". A cap the client does not know about is
 *    exactly how this broke the first time, so the agent chunks at half these caps
 *    (INGEST_MAX_ITEMS_PER_BATCH in apps/agent/src/buffer.ts) and, if the two ever drift apart,
 *    the 413-split path degrades the fleet into MORE REQUESTS - never into lost data.
 *
 * 1000 items/array is ~8x the largest realistic single cycle for the fleet sizes this product
 * targets, and bounds the DB fan-out per request to something the connection pool can absorb
 * (see STATUS_UPSERT_CONCURRENCY in ingest.service.ts). Metrics get their own cap because SNMP
 * `interfaceMetrics` emits ~3 metrics PER INTERFACE, so a rack of 48-port switches produces far
 * more metrics than checks.
 */
export const INGEST_MAX_CHECKS_PER_BATCH = 1000;
export const INGEST_MAX_METRICS_PER_BATCH = 1000;

/**
 * Explicit body-parser limit for the whole API (wired in main.ts).
 *
 * Nest passes no `limit` to express.json(), so body-parser's 100 kB default applied silently.
 * 1mb is stated out loud, is ~2x the worst-case ingest batch that satisfies the item caps above,
 * and is enforced on the INFLATED body - the agent gzips large batches, and body-parser applies
 * the limit after decompression, so compression cannot be used to smuggle a larger payload past it.
 */
export const INGEST_BODY_LIMIT = '1mb';

/** cuid/uuid-shaped identifiers; 64 is generous headroom over a 25-char cuid. */
const MAX_ID_LENGTH = 64;
/** e.g. `if_hc_in_octets.1048576` - a metric name plus an ifIndex suffix. */
const MAX_METRIC_NAME_LENGTH = 64;
/** e.g. `agent:<cuid>`. */
const MAX_SOURCE_LENGTH = 64;
/** 10 minutes. Any probe slower than this timed out long ago; a bigger number is a bug or an attack. */
const MAX_LATENCY_MS = 600_000;

export class StatusCheckDto implements StatusCheckShape {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_ID_LENGTH)
  deviceId!: string;

  @IsBoolean()
  ok!: boolean;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_LATENCY_MS)
  latencyMs?: number;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_SOURCE_LENGTH)
  source?: string;
}

export class MetricSampleDto implements MetricSampleShape {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_ID_LENGTH)
  deviceId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_METRIC_NAME_LENGTH)
  metric!: string;

  /**
   * Finite, but deliberately UNBOUNDED in magnitude: a 64-bit SNMP counter (ifHCInOctets) reaches
   * ~1.8e19 legitimately, so any @Max here would silently reject real data from a busy interface.
   * NaN/Infinity are rejected because they would poison the metric rollups.
   */
  @IsNumber({ allowNaN: false, allowInfinity: false })
  value!: number;

  /** ISO-8601; the service parses it with `new Date(...)`. Kept a string to preserve the wire shape. */
  @IsOptional()
  @IsISO8601()
  ts?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_SOURCE_LENGTH)
  source?: string;
}

export class IngestBatchDto implements IngestBatchShape {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(INGEST_MAX_CHECKS_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => StatusCheckDto)
  checks?: StatusCheckDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(INGEST_MAX_METRICS_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => MetricSampleDto)
  metrics?: MetricSampleDto[];
}
