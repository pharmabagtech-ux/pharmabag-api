import {
  ADMIN_AREAS,
  AdminArea,
  AccessLevel,
  SUPER_ONLY_AREAS,
} from './admin-areas';

/**
 * Reads the single `AdminProfile.permissions` string and answers "may this
 * admin do this?".
 *
 * The column carries two formats at once, on purpose — there is no migration
 * and no downtime, and nobody has to be re-permissioned before the server-side
 * checks can be switched on.
 *
 *   LEGACY  "13x" / "" / "579"
 *           The character codes the admin app has always written. `x` means
 *           super. Each other code grants FULL access to its area. Anything
 *           these codes never named was, in the old browser-side check,
 *           silently allowed — so it stays allowed here too (see
 *           LEGACY_GRANDFATHERED below). That is what keeps every current
 *           admin working exactly as they did today.
 *
 *   V2      "v2:super"
 *           "v2:{\"orders\":\"full\",\"users\":\"read\"}"
 *           Explicit. Anything not named is denied. This is what the rebuilt
 *           Admins screen writes.
 *
 * A malformed `v2:` value grants NOTHING. Failing closed matters: a truncated
 * or hand-edited value must not read as "no restrictions".
 */

export type GrantLevel = 'read' | 'full';

export interface AdminCapabilities {
  isSuper: boolean;
  /** Only meaningful when isSuper is false. */
  areas: Partial<Record<AdminArea, GrantLevel>>;
  /** How the stored value was understood, for the UI and for debugging. */
  format: 'super' | 'v2' | 'legacy' | 'invalid';
}

export const V2_PREFIX = 'v2:';

/**
 * The character codes the admin app has written since day one.
 * Sourced from apps/admin/components/layout/admin-guard.tsx.
 */
const LEGACY_CODE_AREAS: Record<string, AdminArea[]> = {
  '1': ['users'],
  '3': ['products', 'categories'],
  '5': ['orders'],
  '7': ['payments'],
  '9': ['settlements'],
  b: ['tickets'],
  d: ['suggestions'],
  f: ['product-requests'],
  h: ['marketing'],
  j: ['notifications'],
  l: ['referrals'],
  n: ['custom-orders'],
  p: ['analytics'],
  r: ['settings'],
  v: ['marketing'], // "banners", which the admin app files under Marketing
};

/**
 * Areas the OLD browser-side check never named, and therefore let every admin
 * reach. Legacy grants keep them so that turning enforcement on does not lock
 * a working admin out of a screen they used yesterday.
 *
 * `csv-upload`, `migration` and `admins` are deliberately NOT here even though
 * they were also unnamed: each one can destroy or take over the platform, and
 * they are super-only for every format. This is the one intentional tightening
 * in this change.
 */
const LEGACY_GRANDFATHERED: AdminArea[] = ['dashboard', 'blogs', 'seo'];

function emptyCapabilities(format: AdminCapabilities['format']): AdminCapabilities {
  return { isSuper: false, areas: {}, format };
}

function isAdminArea(value: string): value is AdminArea {
  return (ADMIN_AREAS as readonly string[]).includes(value);
}

function normaliseLevel(value: unknown): GrantLevel | null {
  if (value === true || value === 'full' || value === 'write') return 'full';
  if (value === 'read') return 'read';
  return null;
}

function parseV2(raw: string): AdminCapabilities {
  const body = raw.slice(V2_PREFIX.length).trim();

  if (body === 'super') return { isSuper: true, areas: {}, format: 'super' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Fail closed. A value we cannot read is not a value we can trust.
    return emptyCapabilities('invalid');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return emptyCapabilities('invalid');
  }

  const areas: Partial<Record<AdminArea, GrantLevel>> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isAdminArea(key)) continue; // An area we do not know is not an area.
    const level = normaliseLevel(value);
    if (level) areas[key] = level;
  }

  return { isSuper: false, areas, format: 'v2' };
}

function parseLegacy(raw: string): AdminCapabilities {
  if (raw.includes('x')) return { isSuper: true, areas: {}, format: 'super' };

  const areas: Partial<Record<AdminArea, GrantLevel>> = {};
  for (const area of LEGACY_GRANDFATHERED) areas[area] = 'full';

  for (const char of raw) {
    for (const area of LEGACY_CODE_AREAS[char] ?? []) {
      areas[area] = 'full';
    }
  }

  return { isSuper: false, areas, format: 'legacy' };
}

export function parseAdminPermissions(
  raw: string | null | undefined,
): AdminCapabilities {
  const value = (raw ?? '').trim();

  // An empty string is the default for a brand-new admin profile. Under the old
  // browser check it reached every unnamed screen, so it keeps exactly that.
  if (!value) return parseLegacy('');

  return value.startsWith(V2_PREFIX) ? parseV2(value) : parseLegacy(value);
}

export function canAccessArea(
  capabilities: AdminCapabilities,
  area: AdminArea,
  level: AccessLevel,
): boolean {
  if (SUPER_ONLY_AREAS.has(area)) return capabilities.isSuper;
  if (capabilities.isSuper) return true;

  const granted = capabilities.areas[area];
  if (!granted) return false;

  return level === 'read' ? true : granted === 'full';
}

/**
 * The full picture for one admin, in the shape the admin app renders from, so
 * the sidebar and the API can never disagree about what someone may do.
 */
export function describeCapabilities(capabilities: AdminCapabilities) {
  const areas: Record<string, GrantLevel | 'none'> = {};

  for (const area of ADMIN_AREAS) {
    if (SUPER_ONLY_AREAS.has(area)) {
      areas[area] = capabilities.isSuper ? 'full' : 'none';
      continue;
    }
    areas[area] = capabilities.isSuper ? 'full' : (capabilities.areas[area] ?? 'none');
  }

  return {
    isSuper: capabilities.isSuper,
    format: capabilities.format,
    areas,
    superOnlyAreas: [...SUPER_ONLY_AREAS],
  };
}
