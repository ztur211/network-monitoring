import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IngestBatchDto } from '@nodescope/shared';

export interface Buffer { enqueue(b: IngestBatchDto): void; drain(flush: (b: IngestBatchDto) => Promise<void>): Promise<void>; size(): number; }

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
