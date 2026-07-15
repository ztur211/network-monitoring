import { Logger } from '@nestjs/common';
import { envInt } from '../env';

/**
 * These guard a specific way a container blows up: a scheduler interval that is silently NaN
 * or 0. `setInterval(fn, NaN)` does not throw - it coerces to 1ms - so a single empty env var
 * turns a 30-second job into a ~1000/second job.
 */
describe('envInt', () => {
  const KEY = 'ENV_INT_TEST_KEY';
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
    // Silence the intended "falling back" warnings so the suite output stays readable.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.env = original;
    jest.restoreAllMocks();
  });

  it('returns the parsed value when the var is a valid integer', () => {
    process.env[KEY] = '45';
    expect(envInt(KEY, 30)).toBe(45);
  });

  it('falls back when the var is unset', () => {
    delete process.env[KEY];
    expect(envInt(KEY, 30)).toBe(30);
  });

  // The trap: `??` does not default an EMPTY string, and parseInt('') is NaN.
  it('falls back when the var is set but empty', () => {
    process.env[KEY] = '';
    expect(envInt(KEY, 30)).toBe(30);
  });

  it('falls back when the var is only whitespace', () => {
    process.env[KEY] = '   ';
    expect(envInt(KEY, 30)).toBe(30);
  });

  // `parseInt('30s')` is 30, which silently ignores the typo; Number('30s') is NaN.
  it('falls back on a non-numeric value rather than truncating it', () => {
    process.env[KEY] = '30s';
    expect(envInt(KEY, 30)).toBe(30);
  });

  it('falls back on a non-integer value', () => {
    process.env[KEY] = '2.5';
    expect(envInt(KEY, 30)).toBe(30);
  });

  // The catastrophic one: an interval of 0 is a hot loop, not a slow poll.
  it('falls back on zero, which as an interval is a hot loop', () => {
    process.env[KEY] = '0';
    expect(envInt(KEY, 30)).toBe(30);
  });

  it('falls back on a negative value', () => {
    process.env[KEY] = '-5';
    expect(envInt(KEY, 30)).toBe(30);
  });

  it('honours an explicit min', () => {
    process.env[KEY] = '3';
    expect(envInt(KEY, 1000, { min: 100 })).toBe(1000);
  });

  it('clamps to max rather than falling back', () => {
    process.env[KEY] = '5000';
    expect(envInt(KEY, 20, { max: 100 })).toBe(100);
  });

  it('never yields NaN for any garbage input', () => {
    for (const garbage of ['', ' ', 'abc', 'NaN', 'Infinity', '-Infinity', '1e999', '0x10', '--5']) {
      process.env[KEY] = garbage;
      const result = envInt(KEY, 30);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThan(0);
    }
  });
});
