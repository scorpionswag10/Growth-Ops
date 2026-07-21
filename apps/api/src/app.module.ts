import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { LocationsModule } from "./locations/locations.module";
import { CostEventsModule } from "./cost-events/cost-events.module";
import { ContactsModule } from "./contacts/contacts.module";
import { PipelinesModule } from "./pipelines/pipelines.module";
import { WebhooksModule } from "./webhooks/webhooks.module";
import { ConversationsModule } from "./conversations/conversations.module";
import { BookingModule } from "./booking/booking.module";
import { HealthController } from "./health/health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    LocationsModule,
    CostEventsModule,
    ContactsModule,
    PipelinesModule,
    WebhooksModule,
    ConversationsModule,
    BookingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
