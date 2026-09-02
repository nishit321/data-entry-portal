import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

/**
 * A user's own notifications (Q8). Every route is scoped to the authenticated caller — there is no
 * cross-user access — so no @Roles gate is needed beyond being signed in.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: NotificationQueryDto) {
    return this.notifications.list(user, query);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user);
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user, id);
  }
}
