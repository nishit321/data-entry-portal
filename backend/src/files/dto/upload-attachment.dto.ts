import { IsEnum } from 'class-validator';
import { AttachmentKind } from '@prisma/client';

export class UploadAttachmentDto {
  @IsEnum(AttachmentKind, { message: 'Choose a valid attachment type' })
  kind: AttachmentKind;
}
