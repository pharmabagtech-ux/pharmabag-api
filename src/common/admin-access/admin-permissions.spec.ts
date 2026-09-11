import {
  parseAdminPermissions,
  canAccessArea,
  describeCapabilities,
} from './admin-permissions';
import { areaForRoute, levelForMethod, ADMIN_AREAS } from './admin-areas';

/**
 * Admin permissions were enforced only in the browser: the React app checked a
 * character code before rendering a page, and the API asked nothing beyond
 * "are you an ADMIN?". Any admin token could call any admin endpoint directly.
 *
 * Two things have to hold at once here, and they pull in opposite directions:
 *
 *   1. every admin who can sign in today must keep working exactly as they do
 *      (the brief was explicit: current admins must not be affected), and
 *   2. the API must actually enforce something.
 *
 * That is why the legacy character format keeps its exact old meaning —
 * including access to screens the old check never named — while the new v2
 * format denies anything it does not name.
 */

describe('parseAdminPermissions — existing admins keep working', () => {
  it('treats the legacy super code as super', () => {
    const caps = parseAdminPermissions('x');
    expect(caps.isSuper).toBe(true);
    expect(caps.format).toBe('super');
  });

  it('treats a legacy super code mixed with others as super', () => {
    expect(parseAdminPermissions('13x7').isSuper).toBe(true);
  });

  it('grants the same areas the old character codes did', () => {
    const caps = parseAdminPermissions('15');

    expect(canAccessArea(caps, 'users', 'write')).toBe(true);
    expect(canAccessArea(caps, 'orders', 'write')).toBe(true);
    expect(canAccessArea(caps, 'settlements', 'read')).toBe(false);
  });

  it("keeps the code that meant 'products' covering categories, as it always did", () => {
    const caps = parseAdminPermissions('3');
    expect(canAccessArea(caps, 'products', 'write')).toBe(true);
    expect(canAccessArea(caps, 'categories', 'write')).toBe(true);
  });

  it('still reaches screens the old browser check never named', () => {
    // The old guard allowed any unmapped route. Denying these now would lock a
    // working admin out of a page they used yesterday.
    const caps = parseAdminPermissions('1');
    expect(canAccessArea(caps, 'dashboard', 'read')).toBe(true);
    expect(canAccessArea(caps, 'blogs', 'write')).toBe(true);
    expect(canAccessArea(caps, 'seo', 'write')).toBe(true);
  });

  it('treats an empty permission string as the old "everything unnamed" default', () => {
    const caps = parseAdminPermissions('');
    expect(caps.isSuper).toBe(false);
    expect(canAccessArea(caps, 'dashboard', 'read')).toBe(true);
    expect(canAccessArea(caps, 'users', 'read')).toBe(false);
  });

  it('handles null and undefined the same way', () => {
    expect(parseAdminPermissions(null).format).toBe('legacy');
    expect(parseAdminPermissions(undefined).format).toBe('legacy');
  });
});

describe('parseAdminPermissions — v2 grants', () => {
  it('reads v2:super as super', () => {
    const caps = parseAdminPermissions('v2:super');
    expect(caps.isSuper).toBe(true);
    expect(canAccessArea(caps, 'orders', 'write')).toBe(true);
  });

  it('grants exactly what it names and nothing else', () => {
    const caps = parseAdminPermissions('v2:{"orders":"full"}');

    expect(canAccessArea(caps, 'orders', 'write')).toBe(true);
    expect(canAccessArea(caps, 'payments', 'read')).toBe(false);
    // Unlike a legacy grant, v2 does NOT grandfather anything.
    expect(canAccessArea(caps, 'blogs', 'read')).toBe(false);
    expect(canAccessArea(caps, 'dashboard', 'read')).toBe(false);
  });

  it('distinguishes read from full', () => {
    const caps = parseAdminPermissions('v2:{"orders":"read","tickets":"full"}');

    expect(canAccessArea(caps, 'orders', 'read')).toBe(true);
    expect(canAccessArea(caps, 'orders', 'write')).toBe(false);
    expect(canAccessArea(caps, 'tickets', 'write')).toBe(true);
  });

  it('ignores areas it does not recognise instead of trusting them', () => {
    const caps = parseAdminPermissions('v2:{"orders":"full","wharrgarbl":"full"}');
    expect(canAccessArea(caps, 'orders', 'write')).toBe(true);
    expect(Object.keys(caps.areas)).toEqual(['orders']);
  });

  it('ignores a level it does not recognise', () => {
    const caps = parseAdminPermissions('v2:{"orders":"maybe"}');
    expect(canAccessArea(caps, 'orders', 'read')).toBe(false);
  });
});

describe('parseAdminPermissions — malformed values fail closed', () => {
  const malformed = [
    'v2:',
    'v2:{',
    'v2:{"orders":',
    'v2:not-json',
    'v2:[]',
    'v2:null',
    'v2:"orders"',
    'v2:123',
  ];

  it.each(malformed)('grants nothing for %s', (value) => {
    const caps = parseAdminPermissions(value);

    expect(caps.isSuper).toBe(false);
    for (const area of ADMIN_AREAS) {
      expect(canAccessArea(caps, area, 'read')).toBe(false);
    }
  });

  it('never reads a broken value as "no restrictions"', () => {
    // The failure that matters: a truncated or hand-edited value must not
    // accidentally become a super admin.
    expect(parseAdminPermissions('v2:{"orders":"full"').isSuper).toBe(false);
  });
});

describe('the three areas that can destroy or take over the platform', () => {
  const dangerous = ['admins', 'migration', 'csv-upload'] as const;

  it.each(dangerous)('refuses %s to a v2 grant that explicitly asks for it', (area) => {
    const caps = parseAdminPermissions(`v2:{"${area}":"full"}`);
    expect(canAccessArea(caps, area, 'read')).toBe(false);
  });

  it.each(dangerous)('refuses %s to a legacy admin', (area) => {
    expect(canAccessArea(parseAdminPermissions('135'), area, 'read')).toBe(false);
  });

  it.each(dangerous)('allows %s to a super admin', (area) => {
    expect(canAccessArea(parseAdminPermissions('x'), area, 'write')).toBe(true);
    expect(canAccessArea(parseAdminPermissions('v2:super'), area, 'write')).toBe(true);
  });
});

describe('areaForRoute — every admin route is claimed', () => {
  // Taken from the live controllers. If one of these stops resolving, some
  // admin screen has quietly stopped working for everyone who is not super.
  const routes: [string, string, string][] = [
    ['GET', '/api/admin/dashboard', 'dashboard'],
    ['GET', '/api/admin/users', 'users'],
    ['PATCH', '/api/admin/users/:id/block', 'users'],
    ['DELETE', '/api/admin/users/:id', 'users'],
    ['PATCH', '/api/admin/buyers/:id/gst-pan-status', 'users'],
    ['PATCH', '/api/admin/sellers/:id/gst-pan-status', 'users'],
    ['GET', '/api/buyers/all', 'users'],
    ['GET', '/api/admin/products', 'products'],
    ['PATCH', '/api/admin/products/:id/approve', 'products'],
    ['POST', '/api/products', 'products'],
    ['PATCH', '/api/products/:id', 'products'],
    ['DELETE', '/api/products/:id', 'products'],
    ['GET', '/api/products/requests', 'product-requests'],
    ['PATCH', '/api/products/requests/:id/status', 'product-requests'],
    ['POST', '/api/products/bulk', 'csv-upload'],
    ['POST', '/api/master-products/bulk/delete', 'csv-upload'],
    ['GET', '/api/master-products/bulk/export', 'csv-upload'],
    ['POST', '/api/admin/categories', 'categories'],
    ['POST', '/api/admin/subcategories/bulk', 'categories'],
    ['GET', '/api/admin/orders', 'orders'],
    ['PATCH', '/api/admin/orders/:id/status', 'orders'],
    ['GET', '/api/custom-orders/admin', 'custom-orders'],
    ['PATCH', '/api/custom-orders/:id/status', 'custom-orders'],
    ['GET', '/api/admin/payments', 'payments'],
    ['PATCH', '/api/payments/:id/confirm', 'payments'],
    ['PATCH', '/api/payments/:id/reject', 'payments'],
    ['GET', '/api/admin/settlements', 'settlements'],
    ['PATCH', '/api/admin/settlements/:id/mark-paid', 'settlements'],
    ['GET', '/api/admin/tickets', 'tickets'],
    ['POST', '/api/admin/tickets/:id/reply', 'tickets'],
    ['POST', '/api/admin/notifications/broadcast', 'notifications'],
    ['GET', '/api/admin/admins', 'admins'],
    ['POST', '/api/admin/admins', 'admins'],
    ['GET', '/api/admin/analytics/revenue', 'analytics'],
    ['GET', '/api/admin/analytics/realtime', 'analytics'],
    ['GET', '/api/admin/suggestions', 'suggestions'],
    ['POST', '/api/admin/suggestions/import', 'suggestions'],
    ['GET', '/api/admin/marketing', 'marketing'],
    ['DELETE', '/api/admin/marketing/:id', 'marketing'],
    ['POST', '/api/admin/blogs', 'blogs'],
    ['PUT', '/api/admin/blogs/:id', 'blogs'],
    ['POST', '/api/blog/posts', 'blogs'],
    ['PUT', '/api/admin/page-seo', 'seo'],
    ['GET', '/api/admin/redirects/404s', 'seo'],
    ['POST', '/api/admin/referrals', 'referrals'],
    ['GET', '/api/admin/site-settings', 'settings'],
    ['PUT', '/api/admin/site-settings', 'settings'],
    ['POST', '/api/migration/import/users', 'migration'],
    ['DELETE', '/api/migration/rollback-all', 'migration'],
    ['POST', '/api/storage/product-image', 'products'],
    ['POST', '/api/storage/blog-image', 'blogs'],
    ['POST', '/api/storage/payment-proof', 'payments'],
    ['POST', '/api/storage/settlement-proof', 'settlements'],
    ['POST', '/api/storage/kyc', 'users'],
    ['POST', '/api/storage/view', 'dashboard'],
  ];

  it.each(routes)('%s %s belongs to %s', (method, path, expected) => {
    expect(areaForRoute(method, path)).toBe(expected);
  });

  it('resolves the same area with or without the global api prefix', () => {
    expect(areaForRoute('GET', '/admin/orders')).toBe('orders');
    expect(areaForRoute('GET', '/api/admin/orders')).toBe('orders');
  });

  it('resolves a concrete url the same as its route pattern', () => {
    expect(areaForRoute('PATCH', '/api/admin/users/4f3c.../block')).toBe('users');
  });

  it('returns null for a route nobody has claimed, so the guard can deny it', () => {
    expect(areaForRoute('GET', '/api/admin/something-new')).toBeNull();
  });

  it('does not let a product-request route fall through to products', () => {
    // '/products/requests' would match the broader '/products' rule if the
    // order in the rule list were ever changed.
    expect(areaForRoute('GET', '/api/products/requests')).toBe('product-requests');
  });
});

describe('levelForMethod', () => {
  it('treats reads as reads', () => {
    expect(levelForMethod('GET')).toBe('read');
    expect(levelForMethod('head')).toBe('read');
  });

  it('treats everything else as a write', () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect(levelForMethod(method)).toBe('write');
    }
  });
});

describe('describeCapabilities — what the admin app renders from', () => {
  it('reports every area for a super admin', () => {
    const described = describeCapabilities(parseAdminPermissions('v2:super'));

    expect(described.isSuper).toBe(true);
    for (const area of ADMIN_AREAS) {
      expect(described.areas[area]).toBe('full');
    }
  });

  it('reports none for what a scoped admin lacks', () => {
    const described = describeCapabilities(
      parseAdminPermissions('v2:{"orders":"read"}'),
    );

    expect(described.areas.orders).toBe('read');
    expect(described.areas.payments).toBe('none');
    expect(described.areas.admins).toBe('none');
  });

  it('names the super-only areas so the UI can explain itself', () => {
    const described = describeCapabilities(parseAdminPermissions('v2:super'));
    expect(described.superOnlyAreas.sort()).toEqual(
      ['admins', 'csv-upload', 'migration'].sort(),
    );
  });
});
