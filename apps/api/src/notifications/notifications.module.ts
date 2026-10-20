import { Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { IdentityModule } from '../identity/identity.module';
import { MatchesModule } from '../matches/matches.controller';
import { NotificationEvents } from './events/notification-events';
import { EventConsumers, NotificationJobs } from './notification-jobs';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { ExpoPushSender } from './push/expo-push.sender';
import { PUSH_SENDERS, type PushSender } from './push/push-sender';
import { RealtimeEvents } from './realtime/realtime-events';
import { RealtimeGateway } from './realtime/realtime.gateway';

/**
 * Notifications: push (Expo; FCM/APNs adapterlari `PUSH_SENDERS` ga qo'shiladi), in-app ro'yxat,
 * eslatmalar, kutish ro'yxati takliflari va WebSocket (Socket.IO) real-time yangilanishlari.
 * Boshqa modullar bilan faqat outbox event'lari orqali bog'langan.
 */
@Module({
  imports: [IdentityModule, MatchesModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationEvents,
    NotificationJobs,
    RealtimeGateway,
    RealtimeEvents,
    EventConsumers,
    {
      provide: PUSH_SENDERS,
      inject: [ENV],
      useFactory: (env: Env): PushSender[] => [new ExpoPushSender(env.EXPO_PUSH_URL, env.EXPO_ACCESS_TOKEN)],
    },
  ],
  exports: [NotificationsService, NotificationJobs, EventConsumers, RealtimeGateway],
})
export class NotificationsModule {}
