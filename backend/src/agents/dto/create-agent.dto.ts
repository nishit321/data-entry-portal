import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateAgentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  agentReference: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * Owning entity. Ignored for operator callers (forced to their own entity);
   * required for Authority callers creating an agent on an operator's behalf.
   */
  @IsOptional()
  @IsUUID()
  entityId?: string;
}
