import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Note recorded when the Authority resolves or waives a case (optional but recommended). */
export class ResolveCaseDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Keep the note under 1000 characters.' })
  note?: string;
}
