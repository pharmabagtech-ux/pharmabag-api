/**
 * The one place that decides which part of the admin an API route belongs to.
 *
 * Until now admin permissions were enforced only in the React app: the browser
 * checked a character code before rendering a page, and the API itself asked
 * nothing beyond "are you an ADMIN?". Anyone holding any admin token could call
 * any admin endpoint directly — including the CSV import that can empty the
 * catalogue, and the migration rollback.
 *
 * Rules of the road for this file:
 *  - Every admin-only route must match exactly one rule. An unmatched route is
 *    DENIED for scoped admins (super admins are unaffected), which is the safe
 *    direction: a new endpoint arrives locked rather than open.
 *  - Rules are evaluated in order, first match wins, so put the specific ones
 *    above the general ones.
 *  - Paths here exclude the global `api` prefix and any trailing slash.
 */

/** Every distinct area of the admin. These are what a grant names. */
export const ADMIN_AREAS = [
  'dashboard',
  'users',
  'products',
  'csv-upload',
  'categories',
  'product-requests',
  'orders',
  'payments',
  'marketing',
  'blogs',
  'seo',
  'settlements',
  'tickets',
  'admins',
  'notifications',
  'referrals',
  'custom-orders',
  'suggestions',
  'analytics',
  'settings',
  'migration',
] as const;

export type AdminArea = (typeof ADMIN_AREAS)[number];

/** What a request wants to do. GET/HEAD read, everything else writes. */
export type AccessLevel = 'read' | 'write';

/**
 * Areas no partial grant can ever reach, because holding them is equivalent to
 * holding everything:
 *
 *  - `admins`     — whoever can create an admin can create a SUPER admin, so a
 *                   partial grant here would be a privilege-escalation ladder.
 *  - `migration`  — includes `rollback-all`.
 *  - `csv-upload` — the bulk importer can delete the entire catalogue in one
 *                   request.
 *
 * Relaxing any of these is a one-line change here, deliberately kept visible.
 */
export const SUPER_ONLY_AREAS: ReadonlySet<AdminArea> = new Set<AdminArea>([
  'admins',
  'migration',
  'csv-upload',
]);

interface AreaRule {
  /** Matched against the route path with the global prefix removed. */
  pattern: RegExp;
  area: AdminArea;
  /** Restricts the rule to specific methods; omitted means all. */
  methods?: string[];
}

const rule = (pattern: RegExp, area: AdminArea, methods?: string[]): AreaRule => ({
  pattern,
  area,
  methods,
});

/**
 * Ordered, first match wins.
 *
 * Note the several admin-only routes that do NOT live under `/admin` —
 * `/products`, `/payments`, `/storage`, `/migration`, `/custom-orders`,
 * `/blog`, `/buyers/all`, `/master-products/bulk`. Matching on the URL prefix
 * alone would have missed every one of them.
 */
export const ADMIN_AREA_RULES: readonly AreaRule[] = [
  // ── Uploads ────────────────────────────────────────────────────────────
  // Mapped to the area whose screen uses them, so a blogs-only admin can
  // still attach an image to a post without being handed product uploads.
  rule(/^\/storage\/product-image$/, 'products'),
  rule(/^\/storage\/blog-image$/, 'blogs'),
  rule(/^\/storage\/payment-proof$/, 'payments'),
  rule(/^\/storage\/settlement-proof$/, 'settlements'),
  rule(/^\/storage\/(drug-license|kyc)$/, 'users'),
  // Fetching a signed URL for something already uploaded. Every area needs it,
  // and it reveals nothing on its own, so it rides on the dashboard grant that
  // any admin holds.
  rule(/^\/storage\/view$/, 'dashboard'),

  // ── Bulk catalogue import/export ───────────────────────────────────────
  rule(/^\/master-products\/bulk/, 'csv-upload'),
  rule(/^\/products\/bulk$/, 'csv-upload'),

  // ── Data migration ─────────────────────────────────────────────────────
  rule(/^\/migration/, 'migration'),

  // ── Admin accounts ─────────────────────────────────────────────────────
  rule(/^\/admin\/admins/, 'admins'),

  // ── Users, buyers, sellers ─────────────────────────────────────────────
  rule(/^\/admin\/users/, 'users'),
  rule(/^\/admin\/(buyers|sellers)\/[^/]+\/gst-pan-status$/, 'users'),
  rule(/^\/buyers\/all$/, 'users'),

  // ── Product requests (must precede the /products rules) ─────────────────
  rule(/^\/products\/(requests|my-requests)/, 'product-requests'),
  rule(/^\/admin\/product-requests/, 'product-requests'),

  // ── Catalogue ──────────────────────────────────────────────────────────
  rule(/^\/admin\/products/, 'products'),
  rule(/^\/products/, 'products'),

  // ── Taxonomy ───────────────────────────────────────────────────────────
  rule(/^\/admin\/(categories|subcategories)/, 'categories'),

  // ── Orders ─────────────────────────────────────────────────────────────
  rule(/^\/admin\/orders/, 'orders'),
  rule(/^\/custom-orders/, 'custom-orders'),

  // ── Money ──────────────────────────────────────────────────────────────
  rule(/^\/admin\/payments/, 'payments'),
  rule(/^\/payments\/[^/]+\/(confirm|reject)$/, 'payments'),
  rule(/^\/admin\/settlements/, 'settlements'),

  // ── Content ────────────────────────────────────────────────────────────
  rule(/^\/admin\/blogs/, 'blogs'),
  rule(/^\/blog/, 'blogs'),
  rule(/^\/admin\/marketing/, 'marketing'),
  rule(/^\/admin\/suggestions/, 'suggestions'),

  // ── SEO ────────────────────────────────────────────────────────────────
  rule(/^\/admin\/page-seo/, 'seo'),
  rule(/^\/admin\/redirects/, 'seo'),

  // ── Support ────────────────────────────────────────────────────────────
  rule(/^\/admin\/tickets/, 'tickets'),

  // ── Everything else ────────────────────────────────────────────────────
  rule(/^\/admin\/notifications/, 'notifications'),
  rule(/^\/admin\/referrals/, 'referrals'),
  rule(/^\/admin\/analytics/, 'analytics'),
  rule(/^\/admin\/site-settings/, 'settings'),
  rule(/^\/admin\/dashboard/, 'dashboard'),
];

/**
 * Routes every signed-in admin may reach regardless of their grant.
 *
 * Only one thing qualifies: asking what you are allowed to do. The admin app
 * builds its sidebar and route guard from that answer, so an admin who could
 * not fetch it would be locked out of the whole console rather than the parts
 * they lack.
 */
const ALWAYS_ALLOWED = [/^\/admin\/dashboard\/my-permissions$/];

export function isAlwaysAllowedForAdmins(path: string): boolean {
  const normalised = normaliseRoutePath(path);
  return ALWAYS_ALLOWED.some((pattern) => pattern.test(normalised));
}

/** Strips the global prefix and any trailing slash, so rules stay readable. */
export function normaliseRoutePath(path: string): string {
  const withoutPrefix = path.replace(/^\/?api(?=\/|$)/, '');
  const trimmed = withoutPrefix.replace(/\/+$/, '');
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** The area a route belongs to, or null when nothing claims it. */
export function areaForRoute(method: string, path: string): AdminArea | null {
  const normalised = normaliseRoutePath(path);
  const upperMethod = method.toUpperCase();

  for (const entry of ADMIN_AREA_RULES) {
    if (entry.methods && !entry.methods.includes(upperMethod)) continue;
    if (entry.pattern.test(normalised)) return entry.area;
  }

  return null;
}

export function levelForMethod(method: string): AccessLevel {
  return method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD'
    ? 'read'
    : 'write';
}
