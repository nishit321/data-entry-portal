import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnomaliesService } from './anomalies.service';
import { AnomalyQueryDto, AnalyticsQueryDto, TrendsQueryDto } from './dto/analytics-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { AUTHORITY_ROLES, OPERATOR_ROLES } from '../common/utils/data-scope.util';

/** Aggregated compliance analytics. Reads are scoped — operators see only their own figures. */
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly anomalies: AnomaliesService,
  ) {}

  @Get('summary')
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  summary(@CurrentUser() user: AuthUser, @Query() query: AnalyticsQueryDto) {
    return this.analytics.summary(user, query);
  }

  /**
   * Figures that moved implausibly against the operator's own history. Scoped like every other
   * analytics read, so an operator can see the flags raised on their own returns.
   */
  @Get('anomalies')
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  listAnomalies(@CurrentUser() user: AuthUser, @Query() query: AnomalyQueryDto) {
    return this.anomalies.findAll(user, query);
  }

  @Get('trends')
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  trends(@CurrentUser() user: AuthUser, @Query() query: TrendsQueryDto) {
    return this.analytics.trends(user, query);
  }
}
