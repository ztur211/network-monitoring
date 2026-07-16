import {
  decodeSocketPresence,
  encodeSocketPresence,
  partitionSocketPresence,
} from '../socket-presence';

describe('socket presence leases', () => {
  const now = Date.parse('2026-07-15T12:00:00.000Z');

  it('round-trips a live socket record', () => {
    const encoded = encodeSocketPresence({
      userId: 'u-1',
      organizationId: 'org-1',
      expiresAt: now + 60_000,
    });

    expect(decodeSocketPresence(encoded, now)).toEqual({
      userId: 'u-1',
      organizationId: 'org-1',
      expiresAt: now + 60_000,
    });
  });

  it('classifies expired and malformed fields for deletion', () => {
    const result = partitionSocketPresence(
      {
        live: encodeSocketPresence({ userId: 'u-1', organizationId: 'org-1', expiresAt: now + 1 }),
        expired: encodeSocketPresence({ userId: 'u-2', organizationId: 'org-2', expiresAt: now }),
        malformed: '{not json',
        invalidShape: JSON.stringify({ userId: '', organizationId: 3, expiresAt: 'later' }),
      },
      now,
    );

    expect(result.live).toEqual([
      { socketId: 'live', userId: 'u-1', organizationId: 'org-1', expiresAt: now + 1 },
    ]);
    expect(result.staleEntries).toEqual([
      ['expired', encodeSocketPresence({ userId: 'u-2', organizationId: 'org-2', expiresAt: now })],
      ['malformed', '{not json'],
      ['invalidShape', JSON.stringify({ userId: '', organizationId: 3, expiresAt: 'later' })],
    ]);
  });

  it('accepts a live socket with no organization for connection status', () => {
    const encoded = encodeSocketPresence({ userId: 'u-1', organizationId: null, expiresAt: now + 1 });

    expect(decodeSocketPresence(encoded, now)?.organizationId).toBeNull();
  });
});
