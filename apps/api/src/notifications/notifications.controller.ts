import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Global } from '@nestjs/common';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { pushTokenSchema, type AppNotification, type PushTokenInput } from '@sda-shs/shared';
import { InjectDb, type Database } from '../database/database.module';
import { notifications } from '../database/schema';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly service: NotificationsService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<{ items: AppNotification[]; unread: number }> {
    const [rows, [{ unread }]] = await Promise.all([
      this.db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)).limit(50),
      this.db
        .select({ unread: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt))),
    ]);
    return {
      unread,
      items: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  }

  @Post(':id/read')
  @HttpCode(204)
  async markRead(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, user.id), isNull(notifications.readAt)));
  }

  @Post('read-all')
  @HttpCode(204)
  async markAllRead(@CurrentUser() user: AuthUser) {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  }

  @Post('push-tokens')
  @HttpCode(204)
  async registerToken(@CurrentUser() user: AuthUser, @Body(new ZodPipe(pushTokenSchema)) body: PushTokenInput) {
    await this.service.registerPushToken(user.id, body.token, body.platform);
  }

  @Delete('push-tokens/:token')
  @HttpCode(204)
  async removeToken(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    await this.service.removePushToken(user.id, token);
  }
}

@Global()
@Module({ controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
