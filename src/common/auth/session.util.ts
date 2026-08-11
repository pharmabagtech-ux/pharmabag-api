/**
 * Absolute session lifetime.
 *
 * Before this, a logged-in session never actually expired. The access token
 * is short-lived (an hour), but `AuthService.refreshToken` minted a brand
 * new refresh token on every use, and the API client's response interceptor
 * calls it silently on every 401 - so as long as a seller/buyer/admin kept
 * using the app, the refresh chain renewed itself forever. There was no
 * point at which the platform forced a re-login.
 *
 * `sessionStartedAt` is stamped once, at the original login, into the JWT
 * payload, and carried forward unchanged through every subsequent refresh
 * (see `AuthService.generateTokens`/`refreshToken`). `refreshToken` refuses
 * to mint new tokens once that original timestamp is old enough, which
 * naturally forces the interceptor's silent refresh to fail and the app to
 * a real login - no client-side polling or idle-tracking needed, because
 * the existing hourly refresh cycle is already the enforcement point.
 */

/** The floor: an operator can raise this, but never set it any lower. */
export const MIN_SESSION_MAX_AGE_HOURS = 24;

/**
 * Resolves the configured session ceiling, clamped to the platform floor.
 * `undefined`/`0`/negative/non-finite all fall back to the floor rather
 * than being treated as "unlimited" - an auto-logout feature must never be
 * silently disabled by a missing or malformed config value.
 */
export function resolveSessionMaxAgeHours(configuredHours?: number | null): number {
  if (!configuredHours || !Number.isFinite(configuredHours) || configuredHours <= 0) {
    return MIN_SESSION_MAX_AGE_HOURS;
  }
  return Math.max(MIN_SESSION_MAX_AGE_HOURS, configuredHours);
}

/**
 * Whether a session begun at `sessionStartedAt` has run past `maxAgeHours`.
 *
 * An invalid `sessionStartedAt` (missing, NaN) never expires the session -
 * it means the claim predates this feature, and treating it as "expired"
 * would instantly log out every already-signed-in user the moment this
 * ships. `AuthService.refreshToken` re-stamps a fresh `sessionStartedAt` for
 * exactly that case, so it self-heals to a real 24h clock on next refresh.
 */
export function isSessionExpired(
  sessionStartedAt: number | null | undefined,
  maxAgeHours: number,
  now: number = Date.now(),
): boolean {
  if (sessionStartedAt == null || !Number.isFinite(sessionStartedAt)) return false;
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  return now - sessionStartedAt >= maxAgeMs;
}
