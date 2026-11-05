import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Role } from '@platform/contracts';
import { AuthService } from '../../modules/auth/auth.service';
import { loadEnvironment } from '../../config/environment';
export const Public = () => SetMetadata('public', true);
export const Allowed = (...roles: Role[]) => SetMetadata('roles', roles);
/** Page served by our own web app under another hostname (e.g. server name instead of localhost). */
export function sameHost(origin: string, req: Pick<Request, 'get'>): boolean {
  // Next.js rewrites set x-forwarded-host to the address the browser used.
  const host = req.get('x-forwarded-host') ?? req.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (origin && origin !== loadEnvironment().WEB_ORIGIN && !sameHost(origin, req))
        throw new ForbiddenException('Origin not allowed');
      if (req.get('sec-fetch-site') === 'cross-site')
        throw new ForbiddenException('Cross-site request rejected');
    }
    if (
      this.reflector.getAllAndOverride<boolean>('public', [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const user = await this.auth.authenticate(req);
    const allowed = this.reflector.getAllAndOverride<Role[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed && !allowed.includes(user.role)) throw new ForbiddenException();
    return true;
  }
}
