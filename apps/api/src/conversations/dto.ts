import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";

// Channels a human can send from the inbox today. FB/IG/etc. join this list
// when their providers land.
export const SENDABLE_CHANNELS = ["SMS", "EMAIL", "NOTE"] as const;

export class SendMessageDto {
  @IsIn(SENDABLE_CHANNELS as readonly string[])
  channel!: (typeof SENDABLE_CHANNELS)[number];

  @IsString()
  @MinLength(1)
  body!: string;
}

export class IngestMessageDto {
  @IsIn(["SMS", "EMAIL", "FB", "IG", "LIVECHAT", "CALL", "VOICEMAIL"])
  channel!: "SMS" | "EMAIL" | "FB" | "IG" | "LIVECHAT" | "CALL" | "VOICEMAIL";

  @IsIn(["INBOUND", "OUTBOUND"])
  direction!: "INBOUND" | "OUTBOUND";

  @IsString()
  @MinLength(1)
  body!: string;

  @IsOptional()
  @IsString()
  providerMessageId?: string;

  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
}
