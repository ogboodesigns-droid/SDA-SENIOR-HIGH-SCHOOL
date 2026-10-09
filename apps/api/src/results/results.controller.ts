import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import {
  publishResultsSchema,
  reportRemarksSchema,
  resultEntrySchema,
  type PublishResultsInput,
  type ReportRemarksInput,
  type ResultEntryInput,
} from '@sda-shs/shared';
import type { Request } from 'express';
import type { AuthUser } from '../common/auth-user';
import { clientIp, CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AuditService } from '../common/audit.service';
import { ResultsService } from './results.service';
import { ReportsService } from './reports.service';
import { TranscriptService } from './transcript.service';

const sheetQuery = z.object({ termId: z.uuid(), classId: z.uuid(), subjectId: z.uuid() });
const optionalUuid = z.uuid().optional();

@Controller('results')
export class ResultsController {
  constructor(
    private readonly service: ResultsService,
    private readonly transcripts: TranscriptService,
    private readonly audit: AuditService,
  ) {}

  /** The official transcript (published results only). */
  @Get('transcript/:studentId')
  async transcript(@CurrentUser() user: AuthUser, @Param('studentId', ParseUUIDPipe) studentId: string, @Req() req: Request) {
    const transcript = await this.transcripts.build(user, studentId);
    if (user.role !== 'student' && user.role !== 'parent') {
      await this.audit.record({ actorId: user.id, action: 'transcript.issued', entityType: 'student', entityId: studentId, ip: clientIp(req) });
    }
    return transcript;
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthUser, @Query('studentId', new ZodPipe(optionalUuid)) studentId?: string, @Query('termId', new ZodPipe(optionalUuid)) termId?: string) {
    return this.service.mine(user, studentId, termId);
  }

  @RequirePermissions('results:enter')
  @Get('sheet')
  sheet(@CurrentUser() user: AuthUser, @Query(new ZodPipe(sheetQuery)) q: z.infer<typeof sheetQuery>) {
    return this.service.sheet(user, q.termId, q.classId, q.subjectId);
  }

  @Get('student/:studentId')
  forStudent(@CurrentUser() user: AuthUser, @Param('studentId', ParseUUIDPipe) studentId: string, @Query('termId', new ZodPipe(optionalUuid)) termId?: string) {
    return this.service.forStudent(user, studentId, termId);
  }

  @RequirePermissions('results:enter')
  @Put()
  enter(@CurrentUser() user: AuthUser, @Body(new ZodPipe(resultEntrySchema)) body: ResultEntryInput, @Req() req: Request) {
    return this.service.enter(user, body, clientIp(req));
  }

  @RequirePermissions('results:publish')
  @Post('publish')
  @HttpCode(200)
  publish(@CurrentUser() user: AuthUser, @Body(new ZodPipe(publishResultsSchema)) body: PublishResultsInput, @Req() req: Request) {
    return this.service.publish(user, body, clientIp(req));
  }
}

const termQuery = z.object({ termId: z.uuid(), studentId: z.uuid().optional() });

/** Terminal report cards and their remarks. */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** A student's own report (or a parent's child's: pass studentId). */
  @Get('mine')
  mine(@CurrentUser() user: AuthUser, @Query(new ZodPipe(termQuery)) q: z.infer<typeof termQuery>) {
    return this.reports.forStudent(user, q.termId, q.studentId);
  }

  @Get('student/:studentId')
  student(@CurrentUser() user: AuthUser, @Param('studentId', ParseUUIDPipe) studentId: string, @Query('termId', new ZodPipe(z.uuid())) termId: string) {
    return this.reports.forStudent(user, termId, studentId);
  }

  @Get('class/:classId')
  forClass(@CurrentUser() user: AuthUser, @Param('classId', ParseUUIDPipe) classId: string, @Query('termId', new ZodPipe(z.uuid())) termId: string) {
    return this.reports.forClass(user, termId, classId);
  }

  @Put('remarks')
  remarks(@CurrentUser() user: AuthUser, @Body(new ZodPipe(reportRemarksSchema)) body: ReportRemarksInput, @Req() req: Request) {
    return this.reports.saveRemarks(user, body, clientIp(req));
  }
}

@Module({ controllers: [ResultsController, ReportsController], providers: [ResultsService, TranscriptService, ReportsService], exports: [ResultsService] })
export class ResultsModule {}
