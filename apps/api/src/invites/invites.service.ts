import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";
import { AcceptInviteDto, CreateInviteDto } from "./dto";

const INVITE_TTL_DAYS = 7;

@Injectable()
export class InvitesService {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
    private audit: AuditService,
  ) {}

  async create(locationId: string, invitedByUserId: string, dto: CreateInviteDto) {
    const invite = await this.prisma.invite.create({
      data: {
        locationId,
        email: dto.email.toLowerCase(),
        role: dto.role,
        invitedByUserId,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
      },
    });
    await this.audit.log(locationId, invitedByUserId, "Team", "invite_created", {
      targetLabel: invite.email,
      detail: `invited as ${invite.role}`,
    });
    return invite;
  }

  list(locationId: string) {
    return this.prisma.invite.findMany({
      where: { locationId },
      orderBy: { createdAt: "desc" },
    });
  }

  async revoke(locationId: string, inviteId: string, actorId: string) {
    const invite = await this.prisma.invite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.locationId !== locationId) {
      throw new NotFoundException("Invite not found");
    }
    const revoked = await this.prisma.invite.update({
      where: { id: inviteId },
      data: { status: "REVOKED" },
    });
    await this.audit.log(locationId, actorId, "Team", "invite_revoked", {
      targetLabel: invite.email,
    });
    return revoked;
  }

  /** Public preview — what the recipient sees before deciding to accept. */
  async preview(token: string) {
    const invite = await this.findValid(token);
    const [location, existingUser] = await Promise.all([
      this.prisma.location.findUnique({ where: { id: invite.locationId } }),
      this.prisma.user.findUnique({ where: { email: invite.email } }),
    ]);
    return {
      email: invite.email,
      role: invite.role,
      locationName: location?.name ?? "",
      userExists: !!existingUser,
    };
  }

  async accept(token: string, dto: AcceptInviteDto) {
    const invite = await this.findValid(token);
    let user = await this.prisma.user.findUnique({ where: { email: invite.email } });

    if (user) {
      // Existing account: the password step doubles as a login, so accepting
      // an invite can't be used to attach someone else's email to your seat.
      if (!(await bcrypt.compare(dto.password, user.passwordHash))) {
        throw new ForbiddenException("Incorrect password for this email");
      }
    } else {
      if (!dto.name?.trim()) {
        throw new BadRequestException("name is required for a new account");
      }
      user = await this.prisma.user.create({
        data: {
          email: invite.email,
          passwordHash: await bcrypt.hash(dto.password, 12),
          name: dto.name.trim(),
          isPlatformAdmin: false,
        },
      });
    }

    await this.prisma.$transaction([
      this.prisma.membership.upsert({
        where: { userId_locationId: { userId: user.id, locationId: invite.locationId } },
        create: { userId: user.id, locationId: invite.locationId, role: invite.role },
        update: { role: invite.role },
      }),
      this.prisma.invite.update({
        where: { id: invite.id },
        data: { status: "ACCEPTED", acceptedAt: new Date() },
      }),
    ]);

    return this.auth.issueTokensFor(user.id, user.email, user.isPlatformAdmin);
  }

  private async findValid(token: string) {
    const invite = await this.prisma.invite.findUnique({ where: { token } });
    if (!invite || invite.status !== "PENDING" || invite.expiresAt < new Date()) {
      throw new NotFoundException("Invite not found or no longer valid");
    }
    return invite;
  }
}
