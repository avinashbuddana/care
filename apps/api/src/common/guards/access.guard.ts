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
      if (origin && origin !== loadEnvironment().WEB_ORIGIN)
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
