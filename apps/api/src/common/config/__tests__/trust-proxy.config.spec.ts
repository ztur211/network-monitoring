import { resolveTrustProxy } from '../trust-proxy.config';

describe('resolveTrustProxy', () => {
  it('defaults to 1 (a single proxy hop) when unset or blank', () => {
    expect(resolveTrustProxy(undefined)).toBe(1);
    expect(resolveTrustProxy('')).toBe(1);
    expect(resolveTrustProxy('   ')).toBe(1);
  });

  it('parses an integer hop count', () => {
    expect(resolveTrustProxy('0')).toBe(0);
    expect(resolveTrustProxy('2')).toBe(2);
    expect(resolveTrustProxy('10')).toBe(10);
    expect(resolveTrustProxy('  3  ')).toBe(3);
  });

  it('parses the booleans true / false (trust all / trust none)', () => {
    expect(resolveTrustProxy('true')).toBe(true);
    expect(resolveTrustProxy('false')).toBe(false);
  });

  it('passes an IP / subnet / preset string through for Express to interpret', () => {
    expect(resolveTrustProxy('loopback')).toBe('loopback');
    expect(resolveTrustProxy('uniquelocal')).toBe('uniquelocal');
    expect(resolveTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
    expect(resolveTrustProxy('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
  });

  it('treats non-numeric junk as a (likely invalid) subnet string, not a crash', () => {
    // Express will reject a bad subnet at use time; resolution itself must not throw.
    expect(resolveTrustProxy('not-a-real-value')).toBe('not-a-real-value');
  });
});
