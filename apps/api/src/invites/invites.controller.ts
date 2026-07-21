import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Location } from "@growthops/db";
import { CurrentUser, JwtAuthGuard } from "../auth/guards";
import { JwtPayload } from "../auth/auth.service";
import {
  CurrentLocation,
  CurrentMembershipRole,
  TenancyGuard,
} from "../tenancy/tenancy.guard";
import { InvitesService } from "./invites.service";
import { AcceptInviteDto, CreateInviteDto } from "./dto";

function assertCanManageTeam(user: JwtPayload, role?: string) {
  if (!user.isPlatformAdmin && role !== "OWNER" && role !== "ADMIN") {
    throw new ForbiddenException(
      "Only platform admins or location owners/admins manage the team",
    );
  }
}

@Controller("locations/:locationId/invites")
@UseGuards(JwtAuthGuard, TenancyGuard)
export class InvitesController {
  constructor(private invites: InvitesService) {}

  @Post()
  create(
    @CurrentLocation() loc: Location,
    @CurrentUser() user: JwtPayload,
    @CurrentMembershipRole() role: string | undefined,
    @Body() dto: CreateInviteDto,
  ) {
    assertCanManageTeam(user, role);
    return this.invites.create(loc.id, user.sub, dto);
  }

  @Get()
  list(
    @CurrentLocation() loc: Location,
    @CurrentUser() user: JwtPayload,
    @CurrentMembershipRole() role: string | undefined,
  ) {
    assertCanManageTeam(user, role);
    return this.invites.list(loc.id);
  }

  @Delete(":inviteId")
  revoke(
    @CurrentLocation() loc: Location,
    @CurrentUser() user: JwtPayload,
    @CurrentMembershipRole() role: string | undefined,
    @Param("inviteId") inviteId: string,
  ) {
    assertCanManageTeam(user, role);
    return this.invites.revoke(loc.id, inviteId);
  }
}

/** Public — the recipient has no session yet; the token itself is the auth. */
@Controller("invites")
export class InviteAcceptController {
  constructor(private invites: InvitesService) {}

  @Get(":token")
  preview(@Param("token") token: string) {
    return this.invites.preview(token);
  }

  @Post(":token/accept")
  accept(@Param("token") token: string, @Body() dto: AcceptInviteDto) {
    return this.invites.accept(token, dto);
  }
}
