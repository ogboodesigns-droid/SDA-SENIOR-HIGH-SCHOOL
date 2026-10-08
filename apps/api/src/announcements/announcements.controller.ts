import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { announcementSchema, type AnnouncementInput } from '@sda-shs/shared';
import type { Request } from 'express';
import type { AuthUser } from '../common/auth-user';
import { clientIp, CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AnnouncementsService } from './announcements.service';

@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly service: AnnouncementsService) {}

  @Get()
  feed(
    @CurrentUser() user: AuthUser,
    @Query('category') category?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    const n = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const beforeValid = before && !Number.isNaN(Date.parse(before)) ? before : undefined;
    return this.service.feed(user, { category, before: beforeValid, limit: n });
  }

  @RequirePermissions('announcements:publish')
  @Get('manage')
  manage(@CurrentUser() user: AuthUser) {
    return this.service.manageList(user);
  }

  @Get(':id')
  one(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.findVisible(user, id);
  }

  @RequirePermissions('announcements:publish')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(announcementSchema)) body: AnnouncementInput, @Req() req: Request) {
    return this.service.create(user, body, clientIp(req));
  }

  @RequirePermissions('announcements:publish')
  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.service.remove(user, id, clientIp(req));
  }
}

@Module({ controllers: [AnnouncementsController], providers: [AnnouncementsService] })
export class AnnouncementsModule {}
