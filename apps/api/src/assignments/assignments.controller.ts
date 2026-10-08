import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import {
  assignmentSchema,
  gradeSubmissionSchema,
  submissionSchema,
  type AssignmentInput,
  type GradeSubmissionInput,
  type SubmissionInput,
} from '@sda-shs/shared';
import type { Request } from 'express';
import type { AuthUser } from '../common/auth-user';
import { clientIp, CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AssignmentsService } from './assignments.service';

@Controller()
export class AssignmentsController {
  constructor(private readonly service: AssignmentsService) {}

  /** Students and parents: their own assignments. Teachers and leadership: the ones they manage. */
  @Get('assignments')
  list(@CurrentUser() user: AuthUser, @Query('studentId') studentId?: string, @Query('classId') classId?: string) {
    if (user.role === 'student' || user.role === 'parent') return this.service.forStudent(user, studentId);
    return this.service.forStaff(user, classId);
  }

  @Get('assignments/:id')
  one(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('studentId') studentId?: string) {
    return this.service.findOne(user, id, studentId);
  }

  @RequirePermissions('assignments:manage')
  @Post('assignments')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(assignmentSchema)) body: AssignmentInput, @Req() req: Request) {
    return this.service.create(user, body, clientIp(req));
  }

  @RequirePermissions('assignments:manage')
  @Patch('assignments/:id')
  @HttpCode(204)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(assignmentSchema.partial())) body: Partial<AssignmentInput>,
    @Req() req: Request,
  ) {
    await this.service.update(user, id, body, clientIp(req));
  }

  @RequirePermissions('assignments:manage')
  @Delete('assignments/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.service.remove(user, id, clientIp(req));
  }

  @Post('assignments/:id/submission')
  submit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(submissionSchema)) body: SubmissionInput) {
    return this.service.submit(user, id, body);
  }

  @RequirePermissions('assignments:manage')
  @Get('assignments/:id/submissions')
  submissions(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.listSubmissions(user, id);
  }

  @RequirePermissions('assignments:manage')
  @Post('submissions/:id/grade')
  @HttpCode(204)
  async grade(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(gradeSubmissionSchema)) body: GradeSubmissionInput,
    @Req() req: Request,
  ) {
    await this.service.grade(user, id, body, clientIp(req));
  }
}

@Module({ controllers: [AssignmentsController], providers: [AssignmentsService] })
export class AssignmentsModule {}
