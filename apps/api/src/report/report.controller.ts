import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { Location } from "@growthops/db";
import { JwtAuthGuard } from "../auth/guards";
import { CurrentLocation, TenancyGuard } from "../tenancy/tenancy.guard";
import { ReportService } from "./report.service";

@Controller()
export class ReportController {
  constructor(private report: ReportService) {}

  @Get("locations/:locationId/report")
  @UseGuards(JwtAuthGuard, TenancyGuard)
  internal(@CurrentLocation() loc: Location, @Query("days") days?: string) {
    return this.report.compute(loc.id, loc.name, days ? Number(days) : 30);
  }

  // Client-facing live report, shared as a secret link. Read-only aggregates —
  // no contact-level data crosses this boundary.
  @Get("report/:locationId/:token")
  async publicReport(
    @Param("locationId") locationId: string,
    @Param("token") token: string,
    @Query("days") days?: string,
  ) {
    const location = await this.report.resolvePublic(locationId, token);
    return this.report.compute(location.id, location.name, days ? Number(days) : 30);
  }
}
