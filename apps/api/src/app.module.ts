import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { count, eq, sql } from 'drizzle-orm';
import { AccessModule } from './access/access.service';
import { AcademicsModule, CurriculumModule } from './academics/academics.module';
import { HousesModule } from './houses/houses.controller';
import { AnnouncementsModule } from './announcements/announcements.controller';
import { AssignmentsModule } from './assignments/assignments.controller';
import { AuthModule } from './auth/auth.module';
import { config } from './config';
import { AuditModule } from './common/audit.service';
import { AuthGuard } from './common/auth.guard';
import { Public, RequirePermissions } from './common/decorators';
import { AllExceptionsFilter } from './common/exception.filter';
import { DatabaseModule, InjectDb, type Database } from './database/database.module';
import { classes, users } from './database/schema';
import { EventsModule } from './events/events.controller';
import { FilesModule } from './files/files.controller';
import { NotificationsModule } from './notifications/notifications.controller';
import { ResultsModule } from './results/results.controller';
import { SchoolModule } from './school/school.controller';
import { TimetableModule } from './timetable/timetable.controller';
import { UsersModule } from './users/users.module';

@Controller()
class HealthController {
  constructor(@InjectDb() private readonly db: Database) {}

  @Public()
  @Get('health')
  async health() {
    await this.db.execute(sql`select 1`);
    return { status: 'ok' };
  }

  @RequirePermissions('users:read')
  @Get('dashboard')
  async dashboard() {
    const byRole = await this.db
      .select({ role: users.role, n: count() })
      .from(users)
      .where(eq(users.status, 'active'))
      .groupBy(users.role);
    const [{ n: classCount }] = await this.db.select({ n: count() }).from(classes);
    return { activeUsersByRole: Object.fromEntries(byRole.map((r) => [r.role, r.n])), classes: classCount };
  }
}

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 300 }],
      // The e2e suites sign in dozens of times from one address.
      skipIf: () => config().NODE_ENV === 'test',
    }),
    DatabaseModule,
    AuditModule,
    AccessModule,
    CurriculumModule,
    AuthModule,
    NotificationsModule,
    FilesModule,
    UsersModule,
    SchoolModule,
    AcademicsModule,
    TimetableModule,
    AnnouncementsModule,
    EventsModule,
    AssignmentsModule,
    ResultsModule,
    HousesModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
