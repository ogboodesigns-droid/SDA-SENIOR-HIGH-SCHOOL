import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { and, asc, eq, gte, isNull, lt, or } from 'drizzle-orm';
import { dateRangeQuerySchema, eventSchema, type EventInput, type SchoolEvent } from '@sda-shs/shared';
import type { Request } from 'express';
import { InjectDb, type Database } from '../database/database.module';
import { events } from '../database/schema';
import type { AuthUser } from '../common/auth-user';
import { AuditService } from '../common/audit.service';
import { clientIp, CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AccessService } from '../access/access.service';

const MAX_RANGE_DAYS = 400;

function toValues(input: EventInput) {
  return {
    title: input.title,
    description: input.description ?? null,
    category: input.category,
    startsAt: new Date(input.startsAt),
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
    allDay: input.allDay,
    location: input.location ?? null,
    audienceType: input.audienceType,
    audienceRef: input.audienceType === 'school' ? null : (input.audienceRef ?? null),
  };
}

@Controller('events')
export class EventsController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /** Calendar entries overlapping [from, to) that are addressed to the user. */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(dateRangeQuerySchema)) q: { from: string; to: string }): Promise<SchoolEvent[]> {
    const from = new Date(`${q.from}T00:00:00Z`);
    const to = new Date(`${q.to}T00:00:00Z`);
    if (to <= from || to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      throw new BadRequestException('Choose a date range of up to a year');
    }
    const ctx = await this.access.audienceContext(user);
    const rows = await this.db
      .select()
      .from(events)
      .where(
        and(
          lt(events.startsAt, to),
          or(gte(events.endsAt, from), and(isNull(events.endsAt), gte(events.startsAt, from))),
          this.access.audienceFilter(ctx, { audienceType: events.audienceType, audienceRef: events.audienceRef }),
        ),
      )
      .orderBy(asc(events.startsAt));
    return rows.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      category: e.category,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt?.toISOString() ?? null,
      allDay: e.allDay,
      location: e.location,
      audienceType: e.audienceType,
      audienceRef: e.audienceRef,
    }));
  }

  @RequirePermissions('events:manage')
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(eventSchema)) body: EventInput, @Req() req: Request) {
    const [row] = await this.db.insert(events).values({ ...toValues(body), createdBy: user.id }).returning({ id: events.id });
    await this.audit.record({ actorId: user.id, action: 'event.created', entityType: 'event', entityId: row.id, ip: clientIp(req) });
    return row;
  }

  @RequirePermissions('events:manage')
  @Put(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(eventSchema)) body: EventInput, @Req() req: Request) {
    const updated = await this.db.update(events).set(toValues(body)).where(eq(events.id, id)).returning({ id: events.id });
    if (!updated.length) throw new NotFoundException('Event not found');
    await this.audit.record({ actorId: user.id, action: 'event.updated', entityType: 'event', entityId: id, ip: clientIp(req) });
    return updated[0];
  }

  @RequirePermissions('events:manage')
  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.db.delete(events).where(eq(events.id, id));
    await this.audit.record({ actorId: user.id, action: 'event.deleted', entityType: 'event', entityId: id, ip: clientIp(req) });
  }
}

@Module({ controllers: [EventsController] })
export class EventsModule {}
