import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { publishResultsSchema, resultEntrySchema, type PublishResultsInput, type ResultEntryInput } from '@sda-shs/shared';
import type { Request } from 'express';
import type { AuthUser } from '../common/auth-user';
import { clientIp, CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ResultsService } from './results.service';

const sheetQuery = z.object({ termId: z.uuid(), classId: z.uuid(), subjectId: z.uuid() });
const optionalUuid = z.uuid().optional();

@Controller('results')
export class ResultsController {
  constructor(private readonly service: ResultsService) {}

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

@Module({ controllers: [ResultsController], providers: [ResultsService], exports: [ResultsService] })
export class ResultsModule {}
