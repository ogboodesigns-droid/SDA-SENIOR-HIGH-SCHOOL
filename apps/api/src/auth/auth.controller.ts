import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  type ChangePasswordInput,
  type LoginInput,
  type RefreshInput,
} from '@sda-shs/shared';
import type { Request } from 'express';
import type { AuthUser } from '../common/auth-user';
import { AllowPendingPasswordChange, clientIp, CurrentUser, Public } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService, type ClientInfo } from './auth.service';
import { MeService } from './me.service';

function client(req: Request): ClientInfo {
  return { ip: clientIp(req), userAgent: req.headers['user-agent'] ?? null };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly me: MeService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodPipe(loginSchema)) body: LoginInput, @Req() req: Request) {
    return this.auth.login(body, client(req));
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodPipe(refreshSchema)) body: RefreshInput, @Req() req: Request) {
    return this.auth.refresh(body.refreshToken, client(req));
  }

  @AllowPendingPasswordChange()
  @Get('me')
  getMe(@CurrentUser() user: AuthUser) {
    return this.me.build(user.id);
  }

  @AllowPendingPasswordChange()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('change-password')
  @HttpCode(200)
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Req() req: Request,
  ) {
    return this.auth.changePassword(user, body, client(req));
  }

  @AllowPendingPasswordChange()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser) {
    await this.auth.logout(user, false);
  }

  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(@CurrentUser() user: AuthUser) {
    await this.auth.logout(user, true);
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.auth.revokeSession(user, id);
  }
}
