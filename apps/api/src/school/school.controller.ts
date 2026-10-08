import { Body, Controller, Get, Module, NotFoundException, Put, Req } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  assessmentSchemesSchema,
  bellScheduleSchema,
  DEFAULT_ASSESSMENT_SCHEMES,
  DEFAULT_BELL_SCHEDULE,
  type BellSchedule,
  DEFAULT_GRADING_SCALE,
  gradingScaleSchema,
  type AssessmentSchemesInput,
  schoolProfileSchema,
  type GradingScaleInput,
  type SchoolProfile,
  type SchoolProfileInput,
} from '@sda-shs/shared';
import type { Request } from 'express';
import { InjectDb, type Database } from '../database/database.module';
import { schoolProfile } from '../database/schema';
import type { AuthUser } from '../common/auth-user';
import { AuditService } from '../common/audit.service';
import { clientIp, CurrentUser, Public, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';

@Controller('school')
export class SchoolController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Public so the app can show the school's name and logo on the sign-in screen. */
  @Public()
  @Get()
  async profile(): Promise<SchoolProfile> {
    const [row] = await this.db.select().from(schoolProfile).where(eq(schoolProfile.id, 1));
    if (!row) throw new NotFoundException('The school profile has not been set up yet');
    const { id: _id, gradingScale: _g, assessmentSchemes: _a, bellSchedule: _b, updatedAt, ...rest } = row;
    return { ...rest, updatedAt: updatedAt.toISOString() };
  }

  @RequirePermissions('school:manage')
  @Put()
  async update(@CurrentUser() user: AuthUser, @Body(new ZodPipe(schoolProfileSchema)) body: SchoolProfileInput, @Req() req: Request) {
    const values = {
      ...body,
      shortName: body.shortName ?? null,
      motto: body.motto ?? null,
      vision: body.vision ?? null,
      mission: body.mission ?? null,
      history: body.history ?? null,
      address: body.address ?? null,
      phone: body.phone ?? null,
      email: body.email ?? null,
      website: body.website ?? null,
      logoUrl: body.logoUrl ?? null,
    };
    await this.db.insert(schoolProfile).values({ id: 1, ...values }).onConflictDoUpdate({ target: schoolProfile.id, set: values });
    await this.audit.record({ actorId: user.id, action: 'school.profile_updated', entityType: 'school', entityId: '1', ip: clientIp(req) });
    return this.profile();
  }

  @Get('grading-scale')
  async gradingScale(): Promise<GradingScaleInput> {
    const [row] = await this.db.select({ g: schoolProfile.gradingScale }).from(schoolProfile).where(eq(schoolProfile.id, 1));
    return row?.g ?? { bands: DEFAULT_GRADING_SCALE };
  }

  @RequirePermissions('school:manage')
  @Put('grading-scale')
  async setGradingScale(@CurrentUser() user: AuthUser, @Body(new ZodPipe(gradingScaleSchema)) body: GradingScaleInput, @Req() req: Request) {
    const updated = await this.db.update(schoolProfile).set({ gradingScale: body }).where(eq(schoolProfile.id, 1)).returning({ id: schoolProfile.id });
    if (!updated.length) throw new NotFoundException('Set up the school profile first');
    await this.audit.record({ actorId: user.id, action: 'school.grading_scale_updated', entityType: 'school', entityId: '1', metadata: body as unknown as Record<string, unknown>, ip: clientIp(req) });
    return body;
  }

  /** Periods, breaks and school-wide activities (PLC/VLC, early close). */
  @Get('bell-schedule')
  async bellSchedule(): Promise<BellSchedule> {
    const [row] = await this.db.select({ b: schoolProfile.bellSchedule }).from(schoolProfile).where(eq(schoolProfile.id, 1));
    return row?.b ?? DEFAULT_BELL_SCHEDULE;
  }

  @RequirePermissions('timetable:manage')
  @Put('bell-schedule')
  async setBellSchedule(@CurrentUser() user: AuthUser, @Body(new ZodPipe(bellScheduleSchema)) body: BellSchedule, @Req() req: Request) {
    const updated = await this.db.update(schoolProfile).set({ bellSchedule: body }).where(eq(schoolProfile.id, 1)).returning({ id: schoolProfile.id });
    if (!updated.length) throw new NotFoundException('Set up the school profile first');
    await this.audit.record({ actorId: user.id, action: 'school.bell_schedule_updated', entityType: 'school', entityId: '1', ip: clientIp(req) });
    return body;
  }

  /** Assessment components and weights for each semester. */
  @Get('assessment-schemes')
  async assessmentSchemes(): Promise<AssessmentSchemesInput> {
    const [row] = await this.db.select({ a: schoolProfile.assessmentSchemes }).from(schoolProfile).where(eq(schoolProfile.id, 1));
    return row?.a ?? DEFAULT_ASSESSMENT_SCHEMES;
  }

  @RequirePermissions('school:manage')
  @Put('assessment-schemes')
  async setAssessmentSchemes(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(assessmentSchemesSchema)) body: AssessmentSchemesInput,
    @Req() req: Request,
  ) {
    const updated = await this.db.update(schoolProfile).set({ assessmentSchemes: body }).where(eq(schoolProfile.id, 1)).returning({ id: schoolProfile.id });
    if (!updated.length) throw new NotFoundException('Set up the school profile first');
    await this.audit.record({ actorId: user.id, action: 'school.assessment_schemes_updated', entityType: 'school', entityId: '1', ip: clientIp(req) });
    return body;
  }
}

@Module({ controllers: [SchoolController] })
export class SchoolModule {}
