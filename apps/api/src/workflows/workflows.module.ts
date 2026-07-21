import { Module } from "@nestjs/common";
import { WorkflowsController } from "./workflows.controller";
import { WorkflowsService } from "./workflows.service";
import { EngineService } from "./engine.service";
import { ConversationsModule } from "../conversations/conversations.module";
import { ContactsModule } from "../contacts/contacts.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [ConversationsModule, ContactsModule, AuditModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, EngineService],
})
export class WorkflowsModule {}
