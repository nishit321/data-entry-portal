import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClientContext } from '../common/decorators/client-context.decorator';
import { RequestContext } from '../common/utils/request-context.util';
import { Role } from '@prisma/client';
import { SettingsService } from './settings.service';
import { UpdateSettingDto } from './dto/update-setting.dto';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /**
   * The handful of settings the sign-in screen has to obey before anybody has signed in.
   *
   * Public because it has to be: the screen cannot know whether to offer "create an account"
   * without asking, and it is asking before it has a token. Only the settings marked public are
   * returned, and only their values.
   */
  @Public()
  @Get('public')
  publicValues() {
    return this.settings.publicValues();
  }

  @Get()
  @Roles(Role.ADMIN)
  all() {
    return this.settings.all();
  }

  @Patch(':key')
  @Roles(Role.ADMIN)
  update(
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @CurrentUser('id') actorId: string,
    @ClientContext() ctx: RequestContext,
  ) {
    return this.settings.set(key, dto.value, actorId, ctx);
  }
}
