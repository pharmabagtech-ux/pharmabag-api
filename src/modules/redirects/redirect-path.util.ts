/**
 * Path hygiene shared by every redirects surface.
 *
 * Both tables key on the normalized form, so "/Products/Abc/", "/products/abc"
 * and "products/abc?utm=x" are one row, not three — and the storefront
 * middleware applies the same normalization before its map lookup, so the two
 * sides can never disagree about what a path "is".
 */

const MAX_PATH_LENGTH = 500;

/** Returns the canonical form of a site-relative path, or null when unusable. */
export function normalizePath(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  if (raw.length > MAX_PATH_LENGTH) return null;
  // Full URLs don't belong here — redirects/404s key on site-relative paths.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return null;

  let p = raw.split(/[?#]/)[0].trim().toLowerCase();
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/{2,}/g, '/');
  if (p.length > 1) p = p.replace(/\/+$/, '');

  // The homepage can 404 for no reason and must never be redirected away.
  if (p === '/' || p === '') return null;
  return p;
}

/**
 * Exploit-scanner probes (wp-*, .php, .env dumps…) would flood the 404 log
 * with paths no admin will ever redirect. They are dropped at ingestion so
 * the log stays a list of REAL dead links worth fixing.
 */
const NOISE_PATTERNS: RegExp[] = [
  /\.(php|asp|aspx|jsp|cgi|sql|bak|env|ini|log)($|\/)/,
  /(^|\/)\.[^/]+/, // any dotfile segment: /.env, /.git/config, /.well-known probes
  /wp-(admin|login|content|includes|json)/,
  /phpmyadmin/,
  /xmlrpc/,
  /(^|\/)cgi-bin(\/|$)/,
];

export function isNoisePath(path: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(path));
}
