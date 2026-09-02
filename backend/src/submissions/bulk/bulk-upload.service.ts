import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { SubmissionsService } from '../submissions.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { RequestContext } from '../../common/utils/request-context.util';
import { assertCanAccessEntity } from '../../common/utils/data-scope.util';
import { UploadedFile } from '../../files/storage.service';
import {
  buildSubmissionWorkbook,
  parseSubmissionWorkbook,
  type RejectedRow,
} from './submission-workbook';

/** Generous but finite: a questionnaire is tens of rows, not tens of thousands. */
const MAX_ROWS = 5000;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Filling a return from a spreadsheet (Q11).
 *
 * The write itself is deliberately **not** reimplemented here: this service parses the sheet, maps
 * field keys to ids, and then hands the result to `SubmissionsService.saveValues`, which already
 * enforces the editable-draft guard, checks every field belongs to the template, upserts, and
 * audits. That reuse is what makes a bulk upload behave exactly like typing the same answers in,
 * and it is what makes re-uploading the same file safe: the upsert is keyed on
 * (submission, field), so a retry converges rather than duplicating.
 */
@Injectable()
export class BulkUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly submissions: SubmissionsService,
  ) {}

  /** The workbook for a submission, pre-filled with whatever has been answered so far. */
  async buildWorkbook(user: AuthUser, submissionId: string): Promise<Buffer> {
    const submission = await this.prisma.submission.findFirst({
      where: { id: submissionId, deletedAt: null },
      select: {
        id: true,
        entityId: true,
        entity: { select: { name: true } },
        period: { select: { label: true } },
        template: {
          select: {
            name: true,
            sections: {
              orderBy: { order: 'asc' },
              select: {
                title: true,
                fields: {
                  orderBy: { order: 'asc' },
                  select: { id: true, key: true, label: true, unit: true },
                },
              },
            },
          },
        },
        values: {
          select: {
            fieldId: true,
            valueText: true,
            isUnavailable: true,
            unavailableReason: true,
          },
        },
      },
    });
    if (!submission) throw new NotFoundException('Return not found');
    assertCanAccessEntity(user, submission.entityId);

    const valueByFieldId = new Map(submission.values.map((v) => [v.fieldId, v]));
    const fields = submission.template.sections.flatMap((section) =>
      section.fields.map((field) => {
        const existing = valueByFieldId.get(field.id);
        return {
          sectionTitle: section.title,
          key: field.key,
          label: field.label,
          unit: field.unit,
          currentValue: existing?.valueText ?? null,
          isUnavailable: existing?.isUnavailable ?? false,
          unavailableReason: existing?.unavailableReason ?? null,
        };
      }),
    );

    return buildSubmissionWorkbook({
      templateName: submission.template.name,
      periodLabel: submission.period.label,
      entityName: submission.entity.name,
      fields,
    });
  }

  /**
   * Load a filled workbook into a draft. Rows that cannot be used are reported rather than failing
   * the whole file, because one mistyped key should not cost an operator eighty good answers. The
   * saved values are then run through the ordinary validation engine, so the operator sees the same
   * issues they would have seen typing it in, immediately rather than at submit.
   */
  async upload(
    user: AuthUser,
    submissionId: string,
    file: UploadedFile | undefined,
    ctx: RequestContext,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded');
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('That file is too large. The limit is 5 MB.');
    }

    let parsed;
    try {
      parsed = await parseSubmissionWorkbook(file.buffer);
    } catch {
      throw new BadRequestException(
        'We could not read that file. Upload the workbook you downloaded from this return, saved as .xlsx.',
      );
    }
    if (parsed.rows.length > MAX_ROWS) {
      throw new BadRequestException('That workbook has too many rows to load in one go.');
    }

    // Map the sheet's field keys onto this template's fields. Keys are unique per template.
    const submission = await this.prisma.submission.findFirst({
      where: { id: submissionId, deletedAt: null },
      select: { id: true, entityId: true, templateId: true },
    });
    if (!submission) throw new NotFoundException('Return not found');
    assertCanAccessEntity(user, submission.entityId);

    const fields = await this.prisma.templateField.findMany({
      where: { section: { templateId: submission.templateId } },
      select: { id: true, key: true },
    });
    const fieldIdByKey = new Map(fields.map((f) => [f.key, f.id]));

    const rejected: RejectedRow[] = [...parsed.rejected];
    const values = [];
    for (const row of parsed.rows) {
      const fieldId = fieldIdByKey.get(row.key);
      if (!fieldId) {
        rejected.push({
          rowNumber: row.rowNumber,
          key: row.key,
          reason: 'This row does not match any question in this questionnaire.',
        });
        continue;
      }
      values.push({
        fieldId,
        valueText: row.value ?? undefined,
        isUnavailable: row.isUnavailable,
        unavailableReason: row.unavailableReason ?? undefined,
      });
    }

    if (values.length === 0) {
      throw new BadRequestException(
        rejected.length > 0
          ? 'None of the rows in that file could be used. Check the report and try again.'
          : 'That file has no answers in it.',
      );
    }

    // saveValues owns the guard, the template check, the upsert, and its own audit entry.
    await this.submissions.saveValues(user, submissionId, { values }, ctx);

    // A second entry, so the trail distinguishes answers that were uploaded from answers typed in.
    await this.audit.record({
      action: AuditAction.SUBMISSION_BULK_UPLOADED,
      actorId: user.id,
      entityType: 'Submission',
      entityId: submissionId,
      metadata: { applied: values.length, rejected: rejected.length, fileName: file.originalname },
      context: ctx,
    });

    const validation = await this.submissions.validate(user, submissionId);
    return {
      applied: values.length,
      rejected: rejected.sort((a, b) => a.rowNumber - b.rowNumber),
      validation,
    };
  }
}
