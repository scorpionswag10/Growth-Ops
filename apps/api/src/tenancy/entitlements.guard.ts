import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Location } from "@growthops/db";

export const FEATURE_KEY = "required_feature";

/**
 * Gate a route behind a per-location feature flag. This is how capabilities
 * ship dark: SMS gets fully built, but stays 403 for every tenant until their
 * carrier registration is approved and the flag is flipped.
 * Must run AFTER TenancyGuard (needs req.location).
 */
export const RequireFeature = (feature: string) =>
  SetMetadata(FEATURE_KEY, feature);

@Injectable()
export class EntitlementsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const feature = this.reflector.getAllAndOverride<string>(FEATURE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!feature) return true;

    const location: Location | undefined = ctx
      .switchToHttp()
      .getRequest().location;
    const features = (location?.features ?? {}) as Record<string, unknown>;
    if (features[feature] !== true) {
      throw new ForbiddenException(
        `Feature '${feature}' is not enabled for this location`,
      );
    }
    return true;
  }
}
