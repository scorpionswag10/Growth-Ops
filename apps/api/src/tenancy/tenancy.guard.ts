import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Location } from "@growthops/db";
import { PrismaService } from "../prisma/prisma.service";
import { JwtPayload } from "../auth/auth.service";

/**
 * App-layer half of the two-layer tenant isolation (the other half is
 * Postgres RLS). Resolves :locationId from the route, verifies the caller is
 * a platform admin or a member of that location, and attaches the location
 * to the request. Any tenant-scoped route MUST use this guard.
 */
@Injectable()
export class TenancyGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user: JwtPayload | undefined = req.user;
    if (!user) throw new ForbiddenException("Not authenticated");

    const locationId: string | undefined =
      req.params?.locationId ?? req.headers["x-location-id"];
    if (!locationId) throw new ForbiddenException("No location specified");

    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
    });
    if (!location) throw new NotFoundException("Location not found");

    if (!user.isPlatformAdmin) {
      const membership = await this.prisma.membership.findUnique({
        where: { userId_locationId: { userId: user.sub, locationId } },
      });
      if (!membership) {
        throw new ForbiddenException("Not a member of this location");
      }
      req.membershipRole = membership.role;
    }

    req.location = location;
    return true;
  }
}

export const CurrentLocation = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Location =>
    ctx.switchToHttp().getRequest().location,
);

// undefined for platform admins (they bypass membership entirely) — callers
// treat "platform admin" and "OWNER/ADMIN role" as separate, either-suffices
// checks, never assume this is set.
export const CurrentMembershipRole = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | undefined =>
    ctx.switchToHttp().getRequest().membershipRole,
);
