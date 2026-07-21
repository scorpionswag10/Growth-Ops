import { Module } from "@nestjs/common";
import { ContactsController } from "./contacts.controller";
import { CustomFieldsController } from "./custom-fields.controller";
import { ContactsService } from "./contacts.service";

@Module({
  controllers: [ContactsController, CustomFieldsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
