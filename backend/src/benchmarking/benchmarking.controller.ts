import { Controller, Get, Query } from '@nestjs/common';
import { BenchmarkingService } from './benchmarking.service';
import { BenchmarkQueryDto, IndicatorBenchmarkQueryDto } from './dto/benchmark-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { AUTHORITY_ROLES, OPERATOR_ROLES } from '../common/utils/data-scope.util';

/**
 * Where an operator stands against comparable operators (Phase 2).
 *
 * Both audiences use the same routes. The service decides what each is allowed to see, so there is
 * one place to look when someone asks whether a competitor's figures can leak.
 */
@Controller('benchmarking')
export class BenchmarkingController {
  constructor(private readonly benchmarking: BenchmarkingService) {}

  @Get('compliance')
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  compliance(@CurrentUser() user: AuthUser, @Query() query: BenchmarkQueryDto) {
    return this.benchmarking.compliance(user, query);
  }

  /** The questions available to compare. Reading the catalogue reveals no figures. */
  @Get('indicators')
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  indicators(@Query() query: BenchmarkQueryDto) {
    return this.benchmarking.indicators(query);
  }

  @Get('indicator')
  @Roles(...OPERATOR_ROLES, ...AUTHORITY_ROLES)
  indicator(@CurrentUser() user: AuthUser, @Query() query: IndicatorBenchmarkQueryDto) {
    return this.benchmarking.indicator(user, query);
  }
}
