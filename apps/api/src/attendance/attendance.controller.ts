import { Body, Controller, Get, Module, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { attendanceRegisterSchema, type AttendanceRegisterInput } from '@sda-shs/shared';
import type { Request } from 'express';
import type { AuthUser } from '../common/auth-user';
import { clientIp, CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { NotificationsModule } from '../notifications/notifications.controller';
import { AttendanceService, todayInGhana } from './attendance.service';

const registerQuery = z.object({ classId: z.uuid(), date: z.iso.date().optional() });
const summaryQuery = z.object({ classId: z.uuid(), termId: z.uuid() });
const mineQuery = z.object({ termId: z.uuid(), studentId: z.uuid().optional() });
const overviewQuery = z.object({ date: z.iso.date().optional() });

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  @RequirePermissions('attendance:take')
  @Get('classes')
  classes(@CurrentUser() user: AuthUser) {
    return this.service.markableClasses(user);
  }

  /** A class's register for a day (today by default). */
  @RequirePermissions('attendance:take')
  @Get('register')
  register(@CurrentUser() user: AuthUser, @Query(new ZodPipe(registerQuery)) q: z.infer<typeof registerQuery>) {
    return this.service.register(user, q.classId, q.date ?? todayInGhana());
  }

  @RequirePermissions('attendance:take')
  @Put('register')
  save(@CurrentUser() user: AuthUser, @Body(new ZodPipe(attendanceRegisterSchema)) body: AttendanceRegisterInput, @Req() req: Request) {
    return this.service.save(user, body, clientIp(req));
  }

  @RequirePermissions('attendance:take')
  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query(new ZodPipe(summaryQuery)) q: z.infer<typeof summaryQuery>) {
    return this.service.classSummary(user, q.classId, q.termId);
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthUser, @Query(new ZodPipe(mineQuery)) q: z.infer<typeof mineQuery>) {
    return this.service.mine(user, q.termId, q.studentId);
  }

  @Get('overview')
  overview(@CurrentUser() user: AuthUser, @Query(new ZodPipe(overviewQuery)) q: z.infer<typeof overviewQuery>) {
    return this.service.overview(user, q.date ?? todayInGhana());
  }
}

@Module({ imports: [NotificationsModule], controllers: [AttendanceController], providers: [AttendanceService], exports: [AttendanceService] })
export class AttendanceModule {}
