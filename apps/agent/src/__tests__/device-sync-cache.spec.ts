import { describe, it, expect, vi } from 'vitest';
import { cachedFetch } from '../device-sync-cache.js';

describe('cachedFetch', () => {
  it('caches within the interval and re-fetches once it elapses', async () => {
    let now = 1000;
    const fetch = vi.fn(async () => ['a']);
    const get = cachedFetch(fetch, 5000, () => now);

    expect(await get()).toEqual(['a']); // first call → fetch
    expect(await get()).toEqual(['a']); // within interval → cached
    now += 4999;
    await get(); // still within interval → cached
    expect(fetch).toHaveBeenCalledTimes(1);

    now += 2; // 5001ms since last fetch → re-fetch
    await get();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed fetch — retries on the next call', async () => {
    let now = 0;
    const fetch = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(['ok']);
    const get = cachedFetch(fetch, 10_000, () => now);

    await expect(get()).rejects.toThrow('boom'); // failed → not cached
    expect(await get()).toEqual(['ok']); // retries immediately despite the interval
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
