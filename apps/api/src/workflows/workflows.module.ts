import { Module } from "@nestjs/common";
import { WorkflowsController } from "./workflows.controller";
import { WorkflowsService } from "./workflows.service";
import { EngineService } from "./engine.service";
import { ConversationsModule } from "../conversations/conversations.module";
import { ContactsModule } from "../contacts/contacts.module";

@Module({
  imports: [ConversationsModule, ContactsModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, EngineService],
})
export class WorkflowsModule {}
