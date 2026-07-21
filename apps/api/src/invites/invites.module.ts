import { Module } from "@nestjs/common";
import { InviteAcceptController, InvitesController } from "./invites.controller";
import { InvitesService } from "./invites.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [InvitesController, InviteAcceptController],
  providers: [InvitesService],
})
export class InvitesModule {}
