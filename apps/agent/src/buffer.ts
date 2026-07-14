import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IngestBatchDto } from '@nodescope/shared';

/**
 * Items per ingest request, counted per array (checks and metrics are capped separately).
 *
 * MUST stay <= the API's per-batch caps (INGEST_MAX_CHECKS_PER_BATCH / INGEST_MAX_METRICS_PER_BATCH
 * in apps/api/src/monitoring/ingest/ingest.dto.ts, currently 1000 each). It is deliberately HALF of
 * them: the agent ships independently of the API, so an operator can be running a new agent against
 * an older API (or the reverse), and half leaves room for the server's cap to be lowered without
 * instantly breaking every agent in the field.
 *
 * The chunk size is only an optimisation, though - never the safety property. The agent cannot
 * import the server's constant, and a cap the client does not know about is precisely how this
 * broke the first time (the agent sent one batch containing EVERY device, body-parser's silent
 * 100 kB default 413'd it past ~800 devices, and drain() threw the batch away). So correctness
 * rests on drain() below treating a 413 as "split and retry": if these two numbers ever drift
 * apart, the fleet degrades into MORE REQUESTS, never into lost data.
 */
export const INGEST_MAX_ITEMS_PER_BATCH = 500;

export interface Buffer { enqueue(b: IngestBatchDto): void; drain(flush: (b: IngestBatchDto) => Promise<void>): Promise<void>; size(): number; }

const size = (b: IngestBatchDto) => (b.checks?.length ?? 0) + (b.metrics?.length ?? 0);

/**
 * Slice a poll cycle's batch into requests of at most `maxItems` checks and `maxItems` metrics.
 * Both arrays are sliced at the same offset, so a device's check and its metrics usually land in
 * the same request. An empty batch still yields one (empty) chunk, preserving the caller's
 * one-enqueue-per-cycle behaviour.
 */
export function chunkBatch(batch: IngestBatchDto, maxItems: number): IngestBatchDto[] {
  const checks = batch.checks ?? [];
  const metrics = batch.metrics ?? [];
  const count = Math.max(1, Math.ceil(Math.max(checks.length, metrics.length) / maxItems));
  return Array.from({ length: count }, (_, i) => ({
    checks: checks.slice(i * maxItems, (i + 1) * maxItems),
    metrics: metrics.slice(i * maxItems, (i + 1) * maxItems),
  }));
}

/**
 * Halve a batch the server refused as too large. Returns null when it holds at most one item and
 * therefore cannot be split any further.
 *
 * Checks round up and metrics round down so that BOTH halves are strictly smaller than the input
 * even in the awkward {1 check, 1 metric} case (-> {1 check} + {1 metric}, not {1,1} + {}). That
 * strict decrease is what guarantees the retry loop in drain() terminates.
 */
export function splitBatch(batch: IngestBatchDto): [IngestBatchDto, IngestBatchDto] | null {
  const checks = batch.checks ?? [];
  const metrics = batch.metrics ?? [];
  if (checks.length + metrics.length <= 1) return null;
  const c = Math.ceil(checks.length / 2);
  const m = Math.floor(metrics.length / 2);
  return [
    { checks: checks.slice(0, c), metrics: metrics.slice(0, m) },
    { checks: checks.slice(c), metrics: metrics.slice(m) },
  ];
}

export function createBuffer(o: { path: string; maxItems: number }): Buffer {
  let pending: IngestBatchDto[] = [];
  try { pending = readFileSync(o.path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { /* empty */ }
  const persist = () => { mkdirSync(dirname(o.path), { recursive: true }); writeFileSync(o.path, pending.map((b) => JSON.stringify(b)).join('\n')); };
  return {
    enqueue(b) { pending.push(b); if (pending.length > o.maxItems) pending = pending.slice(pending.length - o.maxItems); persist(); },
    size() { return pending.length; },
    async drain(flush) {
      while (pending.length) {
        try { await flush(pending[0]); }
        catch (e) {
          const status = (e as { status?: number })?.status;

          // 413 is "too big", not "bad" - the ONLY honest response is to make the batch smaller and
          // try again. Splitting (rather than dropping) is what stops a fleet outgrowing the
          // server's cap from silently destroying its monitoring data: it degrades into more, and
          // smaller, requests. Each half is strictly smaller, so this terminates.
          if (status === 413) {
            const halves = splitBatch(pending[0]);
            if (halves) {
              console.warn(`[agent] ingest 413: splitting batch of ${size(pending[0])} items and retrying`);
              // Note: deliberately NOT subject to o.maxItems eviction. That cap is enqueue-time
              // backpressure on the number of QUEUED CYCLES; applying it here would drop the very
              // data we are trying to preserve.
              pending.splice(0, 1, ...halves);
              persist();
              continue;
            }
            // A single item the server still calls too large is malformed, not merely oversized
            // (nothing legitimate serializes that big). Splitting cannot help, so drop it rather
            // than retry it forever - one poisoned sample must not wedge the whole queue.
            console.error('[agent] dropping single-item batch (413, cannot split further)');
            pending.shift(); persist(); continue;
          }

          if (status != null && status >= 400 && status < 500 && status !== 429) {
            console.error(`[agent] dropping batch (permanent ${status})`); pending.shift(); persist(); continue;
          }
          throw e; // transient: keep head, stop draining (retry next cycle)
        }
        pending.shift(); persist();
      }
    },
  };
}
