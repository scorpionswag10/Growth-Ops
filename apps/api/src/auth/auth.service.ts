import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { ChangePasswordDto, LoginDto, RegisterDto, UpdateProfileDto } from "./dto";

export interface JwtPayload {
  sub: string;
  email: string;
  isPlatformAdmin: boolean;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  /**
   * The very first registered user becomes the platform admin (bootstrap).
   * After that, only a platform admin can create users.
   */
  async register(dto: RegisterDto, requester?: JwtPayload) {
    const userCount = await this.prisma.user.count();
    if (userCount > 0 && !requester?.isPlatformAdmin) {
      throw new ForbiddenException(
        "Registration is closed. Ask a platform admin to create your account.",
      );
    }
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash: await bcrypt.hash(dto.password, 12),
        name: dto.name,
        isPlatformAdmin: userCount === 0,
      },
    });
    return this.issueTokensFor(user.id, user.email, user.isPlatformAdmin);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid credentials");
    }
    return this.issueTokensFor(user.id, user.email, user.isPlatformAdmin);
  }

  async refresh(refreshToken: string) {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException("Invalid refresh token");
    }
    // Rotate: revoke the used token, issue a fresh pair.
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    const { user } = record;
    return this.issueTokensFor(user.id, user.email, user.isPlatformAdmin);
  }

  async issueTokensFor(
    userId: string,
    email: string,
    isPlatformAdmin: boolean,
  ) {
    const payload: JwtPayload = { sub: userId, email, isPlatformAdmin };
    const accessToken = await this.jwt.signAsync(payload);

    const refreshToken = randomBytes(48).toString("base64url");
    const ttlDays = Number(process.env.REFRESH_TTL_DAYS ?? 30);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
      },
    });
    return { accessToken, refreshToken };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, name: true, phone: true, isPlatformAdmin: true },
    });
    return { sub: user.id, email: user.email, name: user.name, phone: user.phone, isPlatformAdmin: user.isPlatformAdmin };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { name: dto.name, phone: dto.phone },
    });
    return this.getProfile(userId);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException("Current password is incorrect");
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, 12) },
    });
    return { ok: true };
  }

  async logoutAll(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }
}
