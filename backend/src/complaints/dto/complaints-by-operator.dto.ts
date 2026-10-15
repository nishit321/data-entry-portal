import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ComplaintsByOperatorQueryDto {
  /** How many calendar months back, this one included. A year unless asked otherwise. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Give the number of months as a whole number.' })
  @Min(1, { message: 'Look back at least one month.' })
  @Max(36, { message: 'Look back no more than three years.' })
  months: number = 12;
}
