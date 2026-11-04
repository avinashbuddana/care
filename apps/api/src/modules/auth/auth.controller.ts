import { Body, Controller, Post, Get, Req, Res } from '@nestjs/common';
import { ApiTags, ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { Public } from '../../common/guards/access.guard';
import { AuthService, requestUser } from './auth.service';
import { loadEnvironment } from '../../config/environment';
import type { User } from '@platform/contracts';
export class LoginDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(500) password!: string;
}
@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public() @Post('login') async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<User> {
    const { user, token } = await this.auth.login(body.email, body.password, req.ip ?? 'unknown');
    res.cookie('session', token, {
      httpOnly: true,
      secure: loadEnvironment().COOKIE_SECURE === 'true',
      sameSite: 'strict',
      path: '/',
      maxAge: loadEnvironment().SESSION_HOURS * 3600000,
    });
    return user;
  }
  @Get('me') me(@Req() req: Request): User {
    return requestUser(req);
  }
  @Post('logout') async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.auth.logout(req);
    res.clearCookie('session', { path: '/' });
    return { ok: true };
  }
}
