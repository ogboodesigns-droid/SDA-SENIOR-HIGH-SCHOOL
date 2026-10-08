import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import {
  createUserSchema,
  linkGuardianSchema,
  listUsersQuerySchema,
  resetPasswordSchema,
  updateUserSchema,
  type CreateUserInput,
  type LinkGuardianInput,
  type ListUsersQuery,
  type UpdateUserInput,
} from '@sda-shs/shared';
import type { Request } from 'express';
import type { AuthUser } from '../common/auth-user';
import { clientIp, CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @RequirePermissions('users:read')
  @Get('users')
  list(@Query(new ZodPipe(listUsersQuerySchema)) q: ListUsersQuery) {
    return this.users.list(q);
  }

  @RequirePermissions('users:read')
  @Get('users/:id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.detail(id);
  }

  @RequirePermissions('users:manage')
  @Post('users')
  create(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(createUserSchema)) body: CreateUserInput, @Req() req: Request) {
    return this.users.create(actor, body, clientIp(req));
  }

  @RequirePermissions('users:manage')
  @Patch('users/:id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateUserSchema)) body: UpdateUserInput,
    @Req() req: Request,
  ) {
    return this.users.update(actor, id, body, clientIp(req));
  }

  @RequirePermissions('users:manage')
  @Post('users/:id/reset-password')
  @HttpCode(204)
  async resetPassword(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(resetPasswordSchema)) body: { temporaryPassword: string },
    @Req() req: Request,
  ) {
    await this.users.resetPassword(actor, id, body.temporaryPassword, clientIp(req));
  }

  @RequirePermissions('users:manage')
  @Post('guardian-links')
  @HttpCode(204)
  async link(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(linkGuardianSchema)) body: LinkGuardianInput, @Req() req: Request) {
    await this.users.linkGuardian(actor, body, clientIp(req));
  }

  @RequirePermissions('users:manage')
  @Delete('guardian-links/:guardianUserId/:studentId')
  @HttpCode(204)
  async unlink(
    @CurrentUser() actor: AuthUser,
    @Param('guardianUserId', ParseUUIDPipe) guardianUserId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Req() req: Request,
  ) {
    await this.users.unlinkGuardian(actor, guardianUserId, studentId, clientIp(req));
  }

  @RequirePermissions('audit:read')
  @Get('audit-logs')
  auditLog() {
    return this.users.auditLog(200);
  }
}
