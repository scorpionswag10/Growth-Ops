import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { Location } from "@growthops/db";
import { CurrentUser, JwtAuthGuard } from "../auth/guards";
import { JwtPayload } from "../auth/auth.service";
import {
  CurrentLocation,
  CurrentMembershipRole,
  TenancyGuard,
} from "../tenancy/tenancy.guard";
import { AuditService } from "./audit.service";

function assertCanViewAudit(user: JwtPayload, role?: string) {
  if (!user.isPlatformAdmin && role !== "OWNER" && role !== "ADMIN") {
    throw new ForbiddenException(
      "Only platform admins or location owners/admins view the audit log",
    );
  }
}

function csvEscape(v: string) {
  return `"${v.replace(/"/g, '""')}"`;
}

@Controller("locations/:locationId/audit-logs")
@UseGuards(JwtAuthGuard, TenancyGuard)
export class AuditController {
  constructor(private audit: AuditService) {}

  @Get()
  list(
    @CurrentLocation() loc: Location,
    @CurrentUser() user: JwtPayload,
    @CurrentMembershipRole() role: string | undefined,
    @Query("actorId") actorId?: string,
    @Query("module") module?: string,
    @Query("action") action?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("q") q?: string,
    @Query("take") take?: string,
    @Query("skip") skip?: string,
  ) {
    assertCanViewAudit(user, role);
    return this.audit.list(loc.id, {
      actorId,
      module,
      action,
      from,
      to,
      q,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Get("facets")
  facets(
    @CurrentLocation() loc: Location,
    @CurrentUser() user: JwtPayload,
    @CurrentMembershipRole() role: string | undefined,
  ) {
    assertCanViewAudit(user, role);
    return this.audit.facets(loc.id);
  }

  @Get("export")
  async export(
    @CurrentLocation() loc: Location,
    @CurrentUser() user: JwtPayload,
    @CurrentMembershipRole() role: string | undefined,
    @Res() res: Response,
    @Query("actorId") actorId?: string,
    @Query("module") module?: string,
    @Query("action") action?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("q") q?: string,
  ) {
    assertCanViewAudit(user, role);
    const { items } = await this.audit.list(loc.id, {
      actorId,
      module,
      action,
      from,
      to,
      q,
      take: 5000,
    });
    const header = ["Date & Time", "Actor", "Module", "Action", "Target", "Detail"];
    const rows = items.map((r) => [
      r.createdAt.toISOString(),
      r.actorLabel,
      r.module,
      r.action,
      r.targetLabel ?? "",
      r.detail ?? "",
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => csvEscape(String(cell))).join(","))
      .join("\n");
    res.setHeader("content-type", "text/csv");
    res.setHeader(
      "content-disposition",
      `attachment; filename="audit-log-${loc.id}.csv"`,
    );
    res.send(csv);
  }
}
