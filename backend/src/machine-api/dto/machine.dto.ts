import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class MachineStartReturnDto {
  @IsUUID()
  periodId!: string;
}

/** One answer, addressed by question key rather than by field id. */
export class MachineValueDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  key!: string;

  /** The answer, as text. Numbers are validated against the question's own rules on submit. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  value?: string;

  /** Set when the operator genuinely cannot supply this figure, with the reason why. */
  @IsOptional()
  @IsBoolean()
  isUnavailable?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  unavailableReason?: string;

  /** The free-text half of a controlled "Other (specify)" pair. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  otherText?: string;
}

export class MachineSaveValuesDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => MachineValueDto)
  values!: MachineValueDto[];
}

export class MachineSubmitDto {
  /**
   * Who is filing, for the record. Defaults to the credential's own name, which is usually what an
   * integration wants; a caller that files on behalf of a named officer can say so.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  signedName?: string;
}
