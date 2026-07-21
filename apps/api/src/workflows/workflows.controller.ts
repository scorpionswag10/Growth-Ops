import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsIn, IsUUID } from "class-validator";
import { Location } from "@growthops/db";
import { JwtAuthGuard } from "../auth/guards";
import { CurrentLocation, TenancyGuard } from "../tenancy/tenancy.guard";
import { WorkflowsService } from "./workflows.service";

class SetStatusDto {
  @IsIn(["ACTIVE", "PAUSED"])
  status!: "ACTIVE" | "PAUSED";
}

class EnrollDto {
  @IsUUID()
  contactId!: string;
}

@Controller("locations/:locationId/workflows")
@UseGuards(JwtAuthGuard, TenancyGuard)
export class WorkflowsController {
  constructor(private workflows: WorkflowsService) {}

  @Get("catalog")
  catalog() {
    return this.workflows.catalog();
  }

  @Get()
  list(@CurrentLocation() loc: Location) {
    return this.workflows.list(loc.id);
  }

  @Post("from-template/:key")
  fromTemplate(@CurrentLocation() loc: Location, @Param("key") key: string) {
    return this.workflows.createFromTemplate(loc.id, key);
  }

  @Patch(":workflowId")
  setStatus(
    @CurrentLocation() loc: Location,
    @Param("workflowId") workflowId: string,
    @Body() dto: SetStatusDto,
  ) {
    return this.workflows.setStatus(loc.id, workflowId, dto.status);
  }

  @Get(":workflowId/executions")
  executions(
    @CurrentLocation() loc: Location,
    @Param("workflowId") workflowId: string,
  ) {
    return this.workflows.executions(loc.id, workflowId);
  }

  @Post(":workflowId/enroll")
  enroll(
    @CurrentLocation() loc: Location,
    @Param("workflowId") workflowId: string,
    @Body() dto: EnrollDto,
  ) {
    return this.workflows.enrollManual(loc.id, workflowId, dto.contactId);
  }
}
