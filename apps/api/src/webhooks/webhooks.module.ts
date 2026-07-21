import { Module } from "@nestjs/common";
import { WebhooksController } from "./webhooks.controller";
import { ContactsModule } from "../contacts/contacts.module";

@Module({
  imports: [ContactsModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
