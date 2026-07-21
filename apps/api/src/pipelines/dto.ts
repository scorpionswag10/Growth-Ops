import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from "class-validator";

export class CreatePipelineDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  stages!: string[]; // ordered stage names
}

export class CreateOpportunityDto {
  @IsUUID()
  contactId!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsNumber()
  monetaryValue?: number;

  @IsOptional()
  @IsUUID()
  stageId?: string; // defaults to the pipeline's first stage
}

export class UpdateOpportunityDto {
  @IsOptional()
  @IsUUID()
  stageId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsNumber()
  monetaryValue?: number;

  @IsOptional()
  @IsIn(["OPEN", "WON", "LOST", "ABANDONED"])
  status?: "OPEN" | "WON" | "LOST" | "ABANDONED";
}
