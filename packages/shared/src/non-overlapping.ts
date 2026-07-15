/**
 * Wrap an async cycle so that if a tick is still running when the next one fires, the new
 * tick is skipped instead of overlapping.
 *
 * Any poll loop whose work is bounded by a *timeout* rather than a response time can outrun
 * its own interval: a fleet that is large, slow or unreachable makes one cycle take longer
 * than the gap between cycles. A bare `setInterval` then starts a second cycle while the
 * first is still going, and a third, and so on -- each holding its own sockets, child
 * processes and in-flight batches. The cycles contend, so each one gets *slower*, so the
 * next overlap is more likely: the pileup feeds itself and the process's resource use grows
 * without bound. Skipping the tick keeps steady-state cost flat at one cycle's worth, and
 * degrades by probing less often (the honest outcome) rather than by exhausting the host.
 *
 * `onSkip` reports the dropped ticks so a caller can surface the real problem -- the cycle
 * no longer fits in the interval -- instead of silently probing at a slower rate than
 * configured.
 */
export function nonOverlapping(cycle: () => Promise<void>, onSkip?: () => void): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) {
      onSkip?.();
      return;
    }
    running = true;
    try {
      await cycle();
    } finally {
      running = false;
    }
  };
}
