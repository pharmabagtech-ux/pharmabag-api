import {
  MIN_SESSION_MAX_AGE_HOURS,
  resolveSessionMaxAgeHours,
  isSessionExpired,
} from './session.util';

describe('resolveSessionMaxAgeHours', () => {
  it('floors an unset value to 24h', () => {
    expect(resolveSessionMaxAgeHours(undefined)).toBe(24);
  });

  it('floors a zero/negative/NaN value to 24h — never "unlimited"', () => {
    expect(resolveSessionMaxAgeHours(0)).toBe(24);
    expect(resolveSessionMaxAgeHours(-5)).toBe(24);
    expect(resolveSessionMaxAgeHours(NaN)).toBe(24);
  });

  it('respects a configured value at or above the floor', () => {
    expect(resolveSessionMaxAgeHours(24)).toBe(24);
    expect(resolveSessionMaxAgeHours(72)).toBe(72);
  });

  it('clamps a configured value below the floor up to 24h, never lower', () => {
    expect(resolveSessionMaxAgeHours(1)).toBe(MIN_SESSION_MAX_AGE_HOURS);
    expect(resolveSessionMaxAgeHours(23.9)).toBe(MIN_SESSION_MAX_AGE_HOURS);
  });
});

describe('isSessionExpired', () => {
  const HOUR = 60 * 60 * 1000;
  const now = 1_000_000_000_000;

  it('is not expired one second before the 24h mark', () => {
    const startedAt = now - 24 * HOUR + 1000;
    expect(isSessionExpired(startedAt, 24, now)).toBe(false);
  });

  it('is expired exactly at the 24h mark', () => {
    const startedAt = now - 24 * HOUR;
    expect(isSessionExpired(startedAt, 24, now)).toBe(true);
  });

  it('is expired well past the configured ceiling', () => {
    const startedAt = now - 48 * HOUR;
    expect(isSessionExpired(startedAt, 24, now)).toBe(true);
  });

  it('never expires a token issued before this feature (missing/invalid claim)', () => {
    expect(isSessionExpired(undefined, 24, now)).toBe(false);
    expect(isSessionExpired(null, 24, now)).toBe(false);
    expect(isSessionExpired(NaN, 24, now)).toBe(false);
  });

  it('honours a raised ceiling', () => {
    const startedAt = now - 30 * HOUR;
    expect(isSessionExpired(startedAt, 24, now)).toBe(true);
    expect(isSessionExpired(startedAt, 72, now)).toBe(false);
  });
});
