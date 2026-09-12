import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * Feature request 2026-08-07: "a minimum 24 hour automatic logout time".
 *
 * Before this, `refreshToken` unconditionally re-minted tokens on every
 * call, so a session that stayed active never actually ended - the silent
 * refresh in the API client kept renewing it forever. These tests pin the
 * new absolute ceiling: refresh must keep working right up to 24h from the
 * ORIGINAL login (not the last refresh), then start failing.
 */
const HOUR = 60 * 60 * 1000;

const makeService = (opts?: { sessionMaxAgeHours?: number }) => {
  const user = { id: 'user-1', role: 'SELLER', status: 'APPROVED' };

  const prisma = {
    user: { findUnique: jest.fn(() => Promise.resolve(user)) },
  };

  const jwtService = {
    verify: jest.fn(),
    signAsync: jest.fn((payload: any) => Promise.resolve(`token(${JSON.stringify(payload)})`)),
  };

  const configService = {
    get: jest.fn((key: string, fallback?: any) => {
      if (key === 'SESSION_MAX_AGE_HOURS') return opts?.sessionMaxAgeHours;
      if (key === 'JWT_ACCESS_EXPIRES') return fallback ?? '15m';
      if (key === 'JWT_REFRESH_EXPIRES') return fallback ?? '7d';
      return fallback;
    }),
  };

  const service = new AuthService(
    prisma as any,
    jwtService as any,
    configService as any,
    {} as any,
    {} as any,
  );

  return { service, jwtService };
};

describe('AuthService.refreshToken — absolute session ceiling', () => {
  it('keeps refreshing a session just under 24h old', async () => {
    const { service, jwtService } = makeService();
    const sessionStartedAt = Date.now() - (24 * HOUR - 1000);
    jwtService.verify.mockReturnValue({ sub: 'user-1', role: 'SELLER', sessionStartedAt });

    await expect(service.refreshToken('rt')).resolves.toBeDefined();
  });

  it('refuses to refresh once the ORIGINAL login is 24h old, even though this refresh token is fresh', async () => {
    const { service, jwtService } = makeService();
    const sessionStartedAt = Date.now() - 25 * HOUR;
    jwtService.verify.mockReturnValue({ sub: 'user-1', role: 'SELLER', sessionStartedAt });

    await expect(service.refreshToken('rt')).rejects.toThrow(UnauthorizedException);
    await expect(service.refreshToken('rt')).rejects.toThrow(/Session expired/);
  });

  it('carries the ORIGINAL sessionStartedAt forward, not the refresh time', async () => {
    const { service, jwtService } = makeService();
    const sessionStartedAt = Date.now() - 10 * HOUR;
    jwtService.verify.mockReturnValue({ sub: 'user-1', role: 'SELLER', sessionStartedAt });

    await service.refreshToken('rt');

    const signedPayloads = jwtService.signAsync.mock.calls.map((c: any) => c[0]);
    expect(signedPayloads[0].sessionStartedAt).toBe(sessionStartedAt);
    expect(signedPayloads[1].sessionStartedAt).toBe(sessionStartedAt);
  });

  it('never instantly expires a refresh token issued before this feature (no sessionStartedAt claim)', async () => {
    const { service, jwtService } = makeService();
    jwtService.verify.mockReturnValue({ sub: 'user-1', role: 'SELLER' }); // no sessionStartedAt

    await expect(service.refreshToken('rt')).resolves.toBeDefined();
  });

  it('self-heals a pre-feature token onto a fresh 24h clock', async () => {
    const { service, jwtService } = makeService();
    jwtService.verify.mockReturnValue({ sub: 'user-1', role: 'SELLER' });

    const before = Date.now();
    await service.refreshToken('rt');

    const signedPayloads = jwtService.signAsync.mock.calls.map((c: any) => c[0]);
    expect(signedPayloads[0].sessionStartedAt).toBeGreaterThanOrEqual(before);
  });

  it('an operator-raised ceiling is honoured (still >= the 24h floor)', async () => {
    const { service, jwtService } = makeService({ sessionMaxAgeHours: 72 });
    const sessionStartedAt = Date.now() - 30 * HOUR; // past 24h, within 72h
    jwtService.verify.mockReturnValue({ sub: 'user-1', role: 'SELLER', sessionStartedAt });

    await expect(service.refreshToken('rt')).resolves.toBeDefined();
  });

  it('an operator cannot configure below the 24h floor', async () => {
    const { service, jwtService } = makeService({ sessionMaxAgeHours: 1 });
    const sessionStartedAt = Date.now() - 5 * HOUR; // past the attempted 1h, within the 24h floor
    jwtService.verify.mockReturnValue({ sub: 'user-1', role: 'SELLER', sessionStartedAt });

    await expect(service.refreshToken('rt')).resolves.toBeDefined();
  });
});
