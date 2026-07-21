import {
  createParamDecorator,
  ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { JwtPayload } from "./auth.service";

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): JwtPayload =>
    ctx.switchToHttp().getRequest().user,
);
