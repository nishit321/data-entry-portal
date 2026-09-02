import { IsEnum } from 'class-validator';
import { EntityStatus } from '@prisma/client';

export class UpdateEntityStatusDto {
  @IsEnum(EntityStatus, { message: 'Choose a valid status.' })
  status: EntityStatus;
}
