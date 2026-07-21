import { Module } from "@nestjs/common";
import { InviteAcceptController, InvitesController } from "./invites.controller";
import { InvitesService } from "./invites.service";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [InvitesController, InviteAcceptController],
  providers: [InvitesService],
})
export class InvitesModule {}
