import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import {
  EmailNotificationChannel,
  NOTIFICATION_CHANNELS,
  SmsNotificationChannel,
} from './channels';
import { SMS_PROVIDER } from './sms/sms-provider';
import { XTechnologiesSmsProvider } from './sms/x-technologies.provider';

/**
 * Notifications (Q8): in-app messages plus provider-abstracted external delivery, by email and by
 * SMS. Global so any module can trigger a notification without wiring an import, matching the audit
 * module's shape.
 *
 * `SMS_PROVIDER` is exported because confirming a phone number is an identity job, done in
 * `auth`, and it needs the same gateway. One gateway, one place it is constructed.
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    { provide: SMS_PROVIDER, useClass: XTechnologiesSmsProvider },
    EmailNotificationChannel,
    SmsNotificationChannel,
    {
      provide: NOTIFICATION_CHANNELS,
      useFactory: (email: EmailNotificationChannel, sms: SmsNotificationChannel) => [email, sms],
      inject: [EmailNotificationChannel, SmsNotificationChannel],
    },
  ],
  exports: [NotificationsService, SMS_PROVIDER],
})
export class NotificationsModule {}
