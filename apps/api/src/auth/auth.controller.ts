import {
  Body,
  Controller,
  Get,
  Optional,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";
import { AuthService, JwtPayload } from "./auth.service";
import { CurrentUser, JwtAuthGuard } from "./guards";
import { LoginDto, RefreshDto, RegisterDto } from "./dto";

@Controller("auth")
export class AuthController {
  constructor(
    private auth: AuthService,
    @Optional() private jwt: JwtService,
  ) {}

  @Post("register")
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    // Registration is open only for the first user; afterwards it requires a
    // platform-admin bearer token. Decode it here if present (no guard —
    // the endpoint must work unauthenticated exactly once, at bootstrap).
    let requester: JwtPayload | undefined;
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      try {
        requester = this.jwt.verify<JwtPayload>(header.slice(7));
      } catch {
        requester = undefined;
      }
    }
    return this.auth.register(dto, requester);
  }

  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post("refresh")
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: JwtPayload) {
    return user;
  }
}
