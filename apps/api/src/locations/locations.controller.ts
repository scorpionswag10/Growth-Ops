import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { CurrentUser, JwtAuthGuard } from "../auth/guards";
import { JwtPayload } from "../auth/auth.service";
import { CurrentLocation, TenancyGuard } from "../tenancy/tenancy.guard";
import { EntitlementsGuard, RequireFeature } from "../tenancy/entitlements.guard";
import { Location } from "@growthops/db";
import { CostEventsService } from "../cost-events/cost-events.service";

class CreateLocationDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}

class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsIn(["OWNER", "ADMIN", "STAFF"])
  role!: "OWNER" | "ADMIN" | "STAFF";
}

@Controller("locations")
@UseGuards(JwtAuthGuard)
export class LocationsController {
  constructor(
    private prisma: PrismaService,
    private costEvents: CostEventsService,
  ) {}

  @Post()
  async create(@Body() dto: CreateLocationDto, @CurrentUser() user: JwtPayload) {
    if (!user.isPlatformAdmin) {
      throw new ForbiddenException("Only platform admins create locations");
    }
    return this.prisma.location.create({
      data: { name: dto.name, timezone: dto.timezone ?? "America/New_York" },
    });
  }

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    if (user.isPlatformAdmin) return this.prisma.location.findMany();
    return this.prisma.location.findMany({
      where: { memberships: { some: { userId: user.sub } } },
    });
  }

  @Get(":locationId")
  @UseGuards(TenancyGuard)
  get(@CurrentLocation() location: Location) {
    return location;
  }

  @Post(":locationId/members")
  @UseGuards(TenancyGuard)
  async addMember(
    @Param("locationId") locationId: string,
    @Body() dto: AddMemberDto,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!user.isPlatformAdmin) {
      throw new ForbiddenException("Only platform admins manage members");
    }
    const member = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (!member) throw new ForbiddenException("No user with that email");
    return this.prisma.membership.create({
      data: { userId: member.id, locationId, role: dto.role },
    });
  }

  @Get(":locationId/cost-events")
  @UseGuards(TenancyGuard)
  costEventsList(@CurrentLocation() location: Location) {
    return this.costEvents.list(location.id);
  }

  // Proof of the "built but not offered" gate: this route exists, but returns
  // 403 for every location until its features.sms flag is flipped to true.
  @Get(":locationId/sms/status")
  @UseGuards(TenancyGuard, EntitlementsGuard)
  @RequireFeature("sms")
  smsStatus(@CurrentLocation() location: Location) {
    return {
      locationId: location.id,
      module: "sms",
      status: "scaffolded — Twilio integration lands in Phase 2",
    };
  }
}
