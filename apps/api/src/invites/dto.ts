import { IsEmail, IsIn, IsOptional, IsString, MinLength } from "class-validator";

export class CreateInviteDto {
  @IsEmail()
  email!: string;

  @IsIn(["OWNER", "ADMIN", "STAFF"])
  role!: "OWNER" | "ADMIN" | "STAFF";
}

export class AcceptInviteDto {
  @IsOptional()
  @IsString()
  name?: string; // required only when the invited email has no account yet

  @IsString()
  @MinLength(10)
  password!: string;
}
