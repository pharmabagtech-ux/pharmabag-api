/**
 * IP -> country / state / city resolution for analytics breakdowns.
 *
 * Why a local database and not an API: this runs inside the ingest path, which
 * must stay fast and must never become a dependency that can fail. A MaxMind
 * GeoLite2-City .mmdb file is memory-mapped once and every lookup is an
 * in-process read (~0.1ms), so no visitor IP ever leaves the server and an
 * outage elsewhere cannot create gaps in the data.
 *
 * Fail-open is deliberate and total. If the database is missing, unreadable,
 * out of date, or the IP is private/unroutable, every function here returns
 * nulls rather than throwing. Analytics must never be able to break the
 * storefront's tracking endpoint, and geo is strictly additive: sessions
 * recorded before the database was installed simply have null geo and are
 * reported as "Unknown".
 *
 * Tests cover the pure functions (`normalizeGeo`, `firstPublicIp`) directly;
 * they need no .mmdb file, which is what keeps this testable in CI where the
 * database is not present.
 */
import { Logger } from '@nestjs/common';
import type { CityResponse, Reader } from 'maxmind';

const logger = new Logger('GeoResolver');

/** Resolved location. Every field is independently optional. */
export interface GeoLocation {
  /** ISO 3166-1 alpha-2, e.g. "IN". Uppercase. */
  countryCode: string | null;
  /** English country name, e.g. "India". */
  country: string | null;
  /** First-level subdivision — an Indian state, e.g. "Maharashtra". */
  region: string | null;
  /** Subdivision code, e.g. "MH". */
  regionCode: string | null;
  city: string | null;
}

export const EMPTY_GEO: GeoLocation = {
  countryCode: null,
  country: null,
  region: null,
  regionCode: null,
  city: null,
};

/**
 * Trims, bounds and null-blanks one value out of the database.
 *
 * MaxMind occasionally carries empty strings and very long localised names;
 * storing `''` would split reports into a real bucket and a blank one that
 * both mean "unknown", so empties collapse to null.
 */
function clean(value: string | null | undefined, maxLength = 120): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

/**
 * Shapes a raw MaxMind city response into our flat GeoLocation.
 *
 * Exported separately from the reader so it can be unit-tested against
 * hand-built responses — including the partial ones MaxMind really returns,
 * where a country is known but the city is not.
 */
export function normalizeGeo(response: CityResponse | null | undefined): GeoLocation {
  if (!response) return { ...EMPTY_GEO };

  // `subdivisions` is ordered broadest-first; the first entry is the state.
  const subdivision = response.subdivisions?.[0];

  const countryCode = clean(response.country?.iso_code, 2);

  return {
    countryCode: countryCode ? countryCode.toUpperCase() : null,
    country: clean(response.country?.names?.en),
    region: clean(subdivision?.names?.en),
    regionCode: clean(subdivision?.iso_code, 10),
    city: clean(response.city?.names?.en),
  };
}

/** Loopback, private and link-local ranges — never geo-locatable. */
function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.')) return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.') || ip.startsWith('fe80:')) return true;
  // Unique-local IPv6 (fc00::/7).
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true;
  // 172.16.0.0/12
  const match = /^172\.(\d{1,3})\./.exec(ip);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/**
 * Picks the client address out of an `X-Forwarded-For` chain.
 *
 * The header is a comma-separated list appended to by each proxy, so the
 * left-most entry is the original client. Private addresses are skipped
 * because a request that traversed nginx on the same box arrives as
 * `127.0.0.1, <real ip>` — taking position 0 blindly would geo-locate our own
 * server for every visitor. Returns null when nothing routable is present.
 */
export function firstPublicIp(forwardedFor: string | null | undefined): string | null {
  if (!forwardedFor) return null;
  for (const part of forwardedFor.split(',')) {
    let candidate = part.trim();
    if (!candidate) continue;
    // Strip an IPv6 bracket form and any :port suffix on IPv4.
    candidate = candidate.replace(/^\[|\]$/g, '');
    const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(candidate);
    if (ipv4WithPort) candidate = ipv4WithPort[1];
    if (isPrivateIp(candidate)) continue;
    return candidate;
  }
  return null;
}

/**
 * Lazily-opened reader. `undefined` = not yet attempted, `null` = attempted
 * and unavailable (so we do not retry a missing file on every single event).
 */
let reader: Reader<CityResponse> | null | undefined;
let warned = false;

/** Test seam: drops the cached reader so a spec can re-exercise loading. */
export function resetGeoReaderForTests(): void {
  reader = undefined;
  warned = false;
}

/**
 * Path to the GeoLite2-City database. Configurable because the file is not in
 * source control (it is ~70MB and licence-restricted) and lives wherever the
 * deploy puts it.
 */
function databasePath(): string | null {
  return process.env.GEOIP_CITY_DB_PATH?.trim() || null;
}

async function getReader(): Promise<Reader<CityResponse> | null> {
  if (reader !== undefined) return reader;

  const path = databasePath();
  if (!path) {
    reader = null;
    if (!warned) {
      warned = true;
      logger.warn(
        'GEOIP_CITY_DB_PATH is not set — analytics will record sessions without country/state/city. See docs/analytics-geo.md.',
      );
    }
    return reader;
  }

  try {
    const maxmind = await import('maxmind');
    reader = await maxmind.open<CityResponse>(path);
    logger.log(`GeoLite2 city database loaded from ${path}`);
  } catch (err) {
    reader = null;
    if (!warned) {
      warned = true;
      logger.warn(
        `Could not open GeoLite2 database at ${path} — continuing without geo. ${(err as Error).message}`,
      );
    }
  }
  return reader;
}

/**
 * Resolves an IP to a location. Never throws; returns EMPTY_GEO for a private
 * address, an unavailable database, or an IP the database does not know.
 */
export async function resolveGeo(ip: string | null | undefined): Promise<GeoLocation> {
  const candidate = clean(ip, 64);
  if (!candidate || isPrivateIp(candidate)) return { ...EMPTY_GEO };

  const db = await getReader();
  if (!db) return { ...EMPTY_GEO };

  try {
    return normalizeGeo(db.get(candidate));
  } catch {
    // Malformed address, or a lookup the reader rejects — not worth logging
    // per event.
    return { ...EMPTY_GEO };
  }
}
