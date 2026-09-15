import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { EnforcementOrderType } from '@prisma/client';

/**
 * Drafting a formal enforcement order (NCA, 3 September 2026).
 *
 * Every field here is one NCA named: "type (suspension full/partial, cancellation, or
 * licence-shortening), reason, legal basis, effective date and duration".
 *
 * The reason and the legal basis are required rather than optional, and that is deliberate. An
 * order suspends somebody's licence to trade; one that cannot say why, or under what, is not an
 * order an operator can answer or a court can read.
 */
export class DraftEnforcementOrderDto {
  @IsEnum(EnforcementOrderType, { message: 'Choose the kind of order.' })
  type: EnforcementOrderType;

  @IsString()
  @IsNotEmpty({ message: 'Say why this order is being made.' })
  @MaxLength(2000, { message: 'Keep the reason under 2000 characters.' })
  reason: string;

  @IsString()
  @IsNotEmpty({ message: 'Give the section of the Act this rests on.' })
  @MaxLength(200, { message: 'Keep the legal basis under 200 characters.' })
  legalBasis: string;

  @IsISO8601({}, { message: 'Give the date it takes effect.' })
  effectiveFrom: string;

  /**
   * How long it runs, in days.
   *
   * Left out for a cancellation, which does not end. The service refuses a duration on one rather
   * than ignoring it, because "cancelled for 90 days" is not a thing the Act provides for and
   * accepting it would leave the file saying something untrue.
   */
  @IsOptional()
  @IsInt({ message: 'Give the duration in whole days.' })
  @Min(1, { message: 'A duration of less than a day is not an order.' })
  durationDays?: number;
}

/**
 * Approving one.
 *
 * A suspension needs the DG and nothing else. A cancellation needs the Board's minute, because the
 * Board is a body that meets rather than an account that signs in — see the note on the model.
 */
export class ApproveEnforcementOrderDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Give the minute reference, or leave it out entirely.' })
  @MaxLength(100, { message: 'Keep the reference under 100 characters.' })
  boardMinuteRef?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'Give the date the Board decided.' })
  boardDecidedAt?: string;
}

/** Withdrawing one after it has taken effect. */
export class RevokeEnforcementOrderDto {
  @IsString()
  @IsNotEmpty({ message: 'Say why the order is being withdrawn.' })
  @MaxLength(1000, { message: 'Keep the note under 1000 characters.' })
  note: string;
}
