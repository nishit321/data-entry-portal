import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { AUTHORITY_ROLES } from '../common/utils/data-scope.util';

/**
 * Read side of the append-only audit trail. Authority-internal roles only: the
 * log spans every operator, so it never goes to external accounts. Records are
 * written by AuditService.record across the app; this only lists them.
 */
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles(...AUTHORITY_ROLES)
  findAll(@Query() query: AuditQueryDto) {
    return this.audit.findAll(query);
  }
}
