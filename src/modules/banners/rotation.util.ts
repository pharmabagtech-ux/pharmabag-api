export const DEFAULT_ROTATION_SECONDS = 5;
export const MIN_ROTATION_SECONDS = 2;
export const MAX_ROTATION_SECONDS = 30;

/** The SiteSetting row id holding banner configuration. */
export const BANNER_SETTINGS_ROW_ID = 'promo_banners';

/**
 * Turns whatever is in the settings JSON into a delay the storefront can use.
 *
 * Never throws and never returns something unusable: this value is read on a
 * public, cached endpoint that must not 500 because a settings row was
 * hand-edited to `"rotationSeconds": "fast"`.
 */
export function clampRotationSeconds(raw: unknown): number {
  const value = typeof raw === 'string' ? Number(raw) : raw;

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_ROTATION_SECONDS;
  }

  const rounded = Math.round(value);
  if (rounded < MIN_ROTATION_SECONDS) return MIN_ROTATION_SECONDS;
  if (rounded > MAX_ROTATION_SECONDS) return MAX_ROTATION_SECONDS;
  return rounded;
}
