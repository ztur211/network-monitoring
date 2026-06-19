import { deriveState, DeriveConfig } from '../status/derive-state';

const cfg: DeriveConfig = { downThreshold: 3, warnLatencyMs: 250 };

describe('deriveState', () => {
  it('UP on a fast ok check', () => {
    expect(deriveState({ consecutiveFails: 0 }, { ok: true, latencyMs: 10 }, cfg)).toEqual({
      state: 'UP',
      consecutiveFails: 0,
    });
  });

  it('WARNING on a slow ok check', () => {
    expect(deriveState({ consecutiveFails: 0 }, { ok: true, latencyMs: 400 }, cfg).state).toBe('WARNING');
  });

  it('stays a soft WARNING below the threshold, then DOWN at it', () => {
    // < threshold → not yet hard DOWN (anti-flap: one dropped packet won't flap)
    expect(deriveState({ consecutiveFails: 1 }, { ok: false }, cfg)).toEqual({
      state: 'WARNING',
      consecutiveFails: 2,
    });
    expect(deriveState({ consecutiveFails: 2 }, { ok: false }, cfg)).toEqual({
      state: 'DOWN',
      consecutiveFails: 3,
    });
  });

  it('resets fails on recovery', () => {
    expect(deriveState({ consecutiveFails: 5 }, { ok: true, latencyMs: 10 }, cfg)).toEqual({
      state: 'UP',
      consecutiveFails: 0,
    });
  });

  it('treats a missing latency on an ok check as fast (UP)', () => {
    expect(deriveState({ consecutiveFails: 0 }, { ok: true }, cfg).state).toBe('UP');
  });
});
