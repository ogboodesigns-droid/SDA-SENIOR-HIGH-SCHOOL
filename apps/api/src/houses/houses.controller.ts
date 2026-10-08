import { Body, Controller, Get, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { asc, count, desc, eq, sql } from 'drizzle-orm';
import { houseSchema, housePointsSchema, type House, type HousePointsInput } from '@sda-shs/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { InjectDb, type Database } from '../database/database.module';
import { housePoints, houses, students, users } from '../database/schema';
import type { AuthUser } from '../common/auth-user';
import { AuditService } from '../common/audit.service';
import { clientIp, CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';

type HouseInput = z.infer<typeof houseSchema>;

@Controller('houses')
export class HousesController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** House standings, highest points first. Visible to everyone in the school. */
  @Get()
  async list(): Promise<House[]> {
    const points = this.db
      .select({ houseId: housePoints.houseId, total: sql<number>`coalesce(sum(${housePoints.points}), 0)::int`.as('total') })
      .from(housePoints)
      .groupBy(housePoints.houseId)
      .as('p');
    const members = this.db
      .select({ houseId: students.houseId, n: count().as('n') })
      .from(students)
      .groupBy(students.houseId)
      .as('m');
    const rows = await this.db
      .select({ id: houses.id, name: houses.name, colour: houses.colour, points: points.total, members: members.n })
      .from(houses)
      .leftJoin(points, eq(points.houseId, houses.id))
      .leftJoin(members, eq(members.houseId, houses.id))
      .orderBy(desc(sql`coalesce(${points.total}, 0)`), asc(houses.name));
    return rows.map((r) => ({ ...r, points: r.points ?? 0, members: r.members ?? 0 }));
  }

  @Get(':id/points')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.db
      .select({ id: housePoints.id, points: housePoints.points, reason: housePoints.reason, createdAt: housePoints.createdAt, awardedBy: users.fullName })
      .from(housePoints)
      .innerJoin(users, eq(users.id, housePoints.awardedBy))
      .where(eq(housePoints.houseId, id))
      .orderBy(desc(housePoints.createdAt))
      .limit(50);
  }

  @RequirePermissions('houses:manage')
  @Post()
  async create(@Body(new ZodPipe(houseSchema)) body: HouseInput) {
    const [row] = await this.db.insert(houses).values({ name: body.name, colour: body.colour ?? null }).returning();
    return row;
  }

  @RequirePermissions('houses:manage')
  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(houseSchema.partial())) body: Partial<HouseInput>) {
    const [row] = await this.db.update(houses).set(body).where(eq(houses.id, id)).returning();
    if (!row) throw new NotFoundException('House not found');
    return row;
  }

  /** Award (or, with a negative number, deduct) house points. */
  @RequirePermissions('houses:manage')
  @Post(':id/points')
  async award(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(housePointsSchema)) body: HousePointsInput, @Req() req: Request) {
    const [house] = await this.db.select({ id: houses.id }).from(houses).where(eq(houses.id, id));
    if (!house) throw new NotFoundException('House not found');
    const [row] = await this.db.insert(housePoints).values({ houseId: id, points: body.points, reason: body.reason, awardedBy: user.id }).returning();
    await this.audit.record({ actorId: user.id, action: 'house.points_awarded', entityType: 'house', entityId: id, metadata: { points: body.points, reason: body.reason }, ip: clientIp(req) });
    return row;
  }
}

@Module({ controllers: [HousesController] })
export class HousesModule {}
