import { IsDateString, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateLevyRateDto {
  /** Percentage of assessable revenue, 0–100 (e.g. 2.5 for 2.5%). */
  @IsNumber()
  @Min(0)
  @Max(100)
  ratePercent: number;

  @IsDateString()
  effectiveFrom: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

export class UpdateLevyRateDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  ratePercent?: number;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}
