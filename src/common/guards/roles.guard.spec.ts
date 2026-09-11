import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';

/**
 * Before this, the guard asked one question — "is this user an ADMIN?" — and
 * everything finer-grained lived in the React app. An admin scoped to Tickets
 * could open devtools, or curl, and call the user-deletion endpoint.
 *
 * These tests drive the guard directly, because that is the layer an attacker
 * actually meets.
 */

const makeContext = (opts: {
  roles?: Role[];
  user?: any;
  method?: string;
  path?: string;
}) => {
  const request = {
    method: opts.method ?? 'GET',
    route: { path: opts.path ?? '/api/admin/dashboard' },
    url: opts.path ?? '/api/admin/dashboard',
    user: opts.user,
  };

  return {
    ctx: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as any,
    reflector: {
      getAllAndOverride: () => opts.roles,
    } as any,
  };
};

const admin = (permissions: string) => ({
  id: 'admin-1',
  role: Role.ADMIN,
  adminProfile: { permissions },
});

const run = (opts: Parameters<typeof makeContext>[0]) => {
  const { ctx, reflector } = makeContext(opts);
  return new RolesGuard(reflector).canActivate(ctx);
};

describe('RolesGuard — role checks still behave as they did', () => {
  it('lets anything through when no role is required', () => {
    expect(run({ roles: undefined })).toBe(true);
  });

  it('rejects an unauthenticated request', () => {
    expect(() => run({ roles: [Role.ADMIN], user: undefined })).toThrow(
      ForbiddenException,
    );
  });

  it('rejects the wrong role', () => {
    expect(() =>
      run({ roles: [Role.ADMIN], user: { id: 'b', role: Role.BUYER } }),
    ).toThrow(ForbiddenException);
  });

  it('does not apply area checks to buyers or sellers', () => {
    expect(
      run({
        roles: [Role.SELLER],
        user: { id: 's', role: Role.SELLER },
        path: '/api/sellers/dashboard',
      }),
    ).toBe(true);
  });
});

describe('RolesGuard — a scoped admin is actually stopped', () => {
  it('blocks an area the admin was not granted', () => {
    expect(() =>
      run({
        roles: [Role.ADMIN],
        user: admin('v2:{"tickets":"full"}'),
        method: 'DELETE',
        path: '/api/admin/users/:id',
      }),
    ).toThrow(ForbiddenException);
  });

  it('allows the area the admin WAS granted', () => {
    expect(
      run({
        roles: [Role.ADMIN],
        user: admin('v2:{"tickets":"full"}'),
        method: 'POST',
        path: '/api/admin/tickets/:id/reply',
      }),
    ).toBe(true);
  });

  it('allows a read but blocks a write on a read-only grant', () => {
    const readOnly = admin('v2:{"orders":"read"}');

    expect(
      run({ roles: [Role.ADMIN], user: readOnly, method: 'GET', path: '/api/admin/orders' }),
    ).toBe(true);

    expect(() =>
      run({
        roles: [Role.ADMIN],
        user: readOnly,
        method: 'PATCH',
        path: '/api/admin/orders/:id/status',
      }),
    ).toThrow(ForbiddenException);
  });

  it('blocks the bulk importer that can empty the catalogue', () => {
    expect(() =>
      run({
        roles: [Role.ADMIN],
        user: admin('v2:{"products":"full"}'),
        method: 'POST',
        path: '/api/master-products/bulk/delete',
      }),
    ).toThrow(ForbiddenException);
  });

  it('blocks admin creation, which would otherwise be a route to super', () => {
    expect(() =>
      run({
        roles: [Role.ADMIN],
        user: admin('v2:{"admins":"full"}'),
        method: 'POST',
        path: '/api/admin/admins',
      }),
    ).toThrow(ForbiddenException);
  });

  it('blocks migration rollback', () => {
    expect(() =>
      run({
        roles: [Role.ADMIN],
        user: admin('v2:{"orders":"full"}'),
        method: 'DELETE',
        path: '/api/migration/rollback-all',
      }),
    ).toThrow(ForbiddenException);
  });

  it('denies an admin route nobody has mapped, rather than waving it through', () => {
    expect(() =>
      run({
        roles: [Role.ADMIN],
        user: admin('v2:{"orders":"full"}'),
        method: 'POST',
        path: '/api/admin/some-new-endpoint',
      }),
    ).toThrow(ForbiddenException);
  });

  it('falls back to the request url when no route pattern is available', () => {
    const { ctx, reflector } = makeContext({
      roles: [Role.ADMIN],
      user: admin('v2:{"orders":"full"}'),
      method: 'GET',
      path: '/api/admin/orders',
    });
    // Mimic a request that never got a matched route object.
    const request = ctx.switchToHttp().getRequest();
    delete request.route;
    request.originalUrl = '/api/admin/orders?page=2';

    expect(new RolesGuard(reflector).canActivate(ctx)).toBe(true);
  });
});

describe('RolesGuard — current admins are not affected', () => {
  it('lets a legacy super admin through everywhere', () => {
    for (const path of [
      '/api/admin/users/:id',
      '/api/master-products/bulk/delete',
      '/api/migration/rollback-all',
      '/api/admin/admins',
    ]) {
      expect(
        run({ roles: [Role.ADMIN], user: admin('x'), method: 'DELETE', path }),
      ).toBe(true);
    }
  });

  it('lets a legacy scoped admin keep the areas their codes named', () => {
    expect(
      run({
        roles: [Role.ADMIN],
        user: admin('15'),
        method: 'PATCH',
        path: '/api/admin/orders/:id/status',
      }),
    ).toBe(true);
  });

  it('lets a legacy admin keep screens the old check never named', () => {
    expect(
      run({
        roles: [Role.ADMIN],
        user: admin('1'),
        method: 'POST',
        path: '/api/admin/blogs',
      }),
    ).toBe(true);
  });

  it('still refuses a legacy admin the areas their codes never named', () => {
    expect(() =>
      run({
        roles: [Role.ADMIN],
        user: admin('1'),
        method: 'GET',
        path: '/api/admin/settlements',
      }),
    ).toThrow(ForbiddenException);
  });

  it('treats an admin with no permissions string as before, not as super', () => {
    expect(
      run({ roles: [Role.ADMIN], user: admin(''), method: 'GET', path: '/api/admin/dashboard' }),
    ).toBe(true);

    expect(() =>
      run({ roles: [Role.ADMIN], user: admin(''), method: 'GET', path: '/api/admin/users' }),
    ).toThrow(ForbiddenException);
  });

  it('always lets an admin ask what they are allowed to do', () => {
    // Otherwise an admin whose grant omits `dashboard` cannot load the console
    // at all, because the sidebar and route guard are built from this answer.
    expect(
      run({
        roles: [Role.ADMIN],
        user: admin('v2:{"tickets":"read"}'),
        method: 'GET',
        path: '/api/admin/dashboard/my-permissions',
      }),
    ).toBe(true);
  });

  it('does not treat a missing adminProfile as super', () => {
    expect(() =>
      run({
        roles: [Role.ADMIN],
        user: { id: 'a', role: Role.ADMIN },
        method: 'DELETE',
        path: '/api/admin/users/:id',
      }),
    ).toThrow(ForbiddenException);
  });
});
