import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaymentKind, PaymentMethod } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BooleanQuery } from '../../common/dto/boolean-query.decorator';

/** Above any levy or penalty the portal has assessed by several orders of magnitude. */
const MAX_AMOUNT = 1_000_000_000_000;

export class RecordPaymentDto {
  @IsEnum(PaymentKind, { message: 'Say whether this pays a levy or a penalty.' })
  kind!: PaymentKind;

  @IsUUID('4', { message: 'Choose the operator that paid.' })
  entityId!: string;

  @ValidateIf((o: RecordPaymentDto) => o.kind === PaymentKind.LEVY)
  @IsUUID('4', { message: 'Choose the reporting period whose levy this pays.' })
  periodId?: string;

  @ValidateIf((o: RecordPaymentDto) => o.kind === PaymentKind.PENALTY)
  @IsUUID('4', { message: 'Choose the compliance case whose penalty this pays.' })
  enforcementCaseId?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter the amount with at most two decimals.' })
  @Min(0.01, { message: 'Enter the amount that was received.' })
  @Max(MAX_AMOUNT, { message: 'That amount is larger than anything the portal has assessed.' })
  amount!: number;

  @IsDateString({ strict: true }, { message: 'Enter the date the money arrived.' })
  paidOn!: string;

  @IsEnum(PaymentMethod, { message: 'Choose how the money was paid.' })
  method!: PaymentMethod;

  @IsString()
  @MinLength(3, { message: "Enter the bank's reference for the payment." })
  @MaxLength(100, { message: 'Keep the reference under 100 characters.' })
  bankReference!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Keep the note under 500 characters.' })
  note?: string;
}

export class ReversePaymentDto {
  /*
   * Ten characters, because "error" and "wrong" are not reasons anybody can act on later. A
   * reversal is the only change a payment ever receives, and the reason is what an auditor reads.
   */
  @IsString()
  @MinLength(10, { message: 'Say why this payment is being reversed, in a sentence.' })
  @MaxLength(500, { message: 'Keep the reason under 500 characters.' })
  reason!: string;
}

export const PAYMENT_SORT_COLUMNS = ['paidOn', 'recordedAt', 'amount'] as const;
export type PaymentSortColumn = (typeof PAYMENT_SORT_COLUMNS)[number];

export class PaymentQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(PAYMENT_SORT_COLUMNS)
  sort: PaymentSortColumn = 'paidOn';

  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @IsEnum(PaymentKind)
  kind?: PaymentKind;

  @IsOptional()
  @IsUUID()
  periodId?: string;

  /** Reversed payments are listed by default; they are part of the record. This hides them. */
  @BooleanQuery('hideReversed')
  hideReversed?: boolean;
}

export class BalancesQueryDto {
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @IsUUID()
  periodId?: string;
}
