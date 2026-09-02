import { BadRequestException, Controller, Get, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { SchedulerService, type JobName } from './scheduler.service';
import { Roles } from '../common/decorators/roles.decorator';

const JOB_NAMES: JobName[] = ['compliance-sweep', 'document-expiry', 'notification-retry'];

/**
 * Visibility over the background jobs, and a way to run one by hand.
 *
 * A scheduler nobody can see is a scheduler nobody trusts: after a deployment or an outage the
 * Authority needs to be able to tell whether the nightly sweeps actually ran, without reading
 * server logs.
 */
@Controller('scheduler')
export class SchedulerController {
  constructor(private readonly scheduler: SchedulerService) {}

  @Get('status')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  status() {
    return this.scheduler.status();
  }

  @Post('jobs/:name/run')
  @Roles(Role.ADMIN)
  run(@Param('name') name: string) {
    if (!JOB_NAMES.includes(name as JobName)) {
      throw new BadRequestException(`There is no job called "${name}".`);
    }
    return this.scheduler.trigger(name as JobName);
  }
}
