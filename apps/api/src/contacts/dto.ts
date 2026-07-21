import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from "class-validator";

export class UpsertContactDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  dndSms?: boolean;

  @IsOptional()
  @IsBoolean()
  dndEmail?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;
}

export class TagsDto {
  @IsArray()
  @IsString({ each: true })
  tags!: string[];
}

export class CreateCustomFieldDto {
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: "key must be snake_case (a-z, 0-9, _)",
  })
  key!: string;

  @IsString()
  @MinLength(1)
  label!: string;

  @IsIn(["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT"])
  type!: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT";

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];
}
