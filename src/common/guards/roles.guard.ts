import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import {
  areaForRoute,
  isAlwaysAllowedForAdmins,
  levelForMethod,
} from '../admin-access/admin-areas';
import {
  canAccessArea,
  parseAdminPermissions,
} from '../admin-access/admin-permissions';

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const { user } = request;

    if (!user) {
      throw new ForbiddenException('No authenticated user found');
    }

    const hasRole = requiredRoles.some((role) => user.role === role);

    if (!hasRole) {
      throw new ForbiddenException(
        'You do not have permission to access this resource',
      );
    }

    // Area-level checks apply only to admins on admin-gated routes. Every other
    // role reaches this point unchanged.
    if (user.role === Role.ADMIN && requiredRoles.includes(Role.ADMIN)) {
      this.assertAdminMayReach(request, user);
    }

    return true;
  }

  /**
   * Admin permissions used to be enforced only in the browser: the React app
   * checked a character code before rendering a page and the API asked nothing
   * beyond "are you an ADMIN?". Any admin token could therefore call any admin
   * endpoint directly. This is where that stops.
   */
  private assertAdminMayReach(request: any, user: any): void {
    const capabilities = parseAdminPermissions(
      user?.adminProfile?.permissions,
    );

    // Super admins keep an unconditional pass, which is also what makes a
    // missing rule below a contained problem rather than an outage.
    if (capabilities.isSuper) return;

    const method: string = request.method ?? 'GET';
    // `route.path` is the pattern the handler was registered at
    // (/api/admin/users/:id); the raw url is the fallback and matches the same
    // rules because they are anchored on the leading segments.
    const path: string =
      request.route?.path ?? (request.originalUrl ?? request.url ?? '').split('?')[0];

    // "What am I allowed to do?" must never itself require a permission.
    if (isAlwaysAllowedForAdmins(path)) return;

    const area = areaForRoute(method, path);

    if (!area) {
      // Deny-by-default. A new admin endpoint that nobody mapped arrives locked
      // rather than open, and says so loudly enough to be noticed in the logs.
      this.logger.warn(
        `Admin route has no area mapping, denying scoped admin: ${method} ${path}`,
      );
      throw new ForbiddenException(
        'This area is not available to your admin account.',
      );
    }

    if (!canAccessArea(capabilities, area, levelForMethod(method))) {
      throw new ForbiddenException(
        `Your admin account does not have access to ${area}.`,
      );
    }
  }
}
