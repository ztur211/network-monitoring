import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createPkce } from '../pkce';

describe('createPkce', () => {
  it('produces a verifier and an S256 challenge = base64url(sha256(verifier))', () => {
    const { verifier, challenge } = createPkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });
});
