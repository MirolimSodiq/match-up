import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../common/errors';
import { IS_PUBLIC, OPTIONAL_AUTH, ROLES, type UserRole } from '../common/http';
import { TokensService } from './tokens.service';

/** Global guard: Bearer JWT (EdDSA) + rol tekshiruvi. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH, targets);
    const req = ctx.switchToHttp().getRequest<Request>();

    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;

    if (!token) {
      if (isPublic || optional) return true;
      throw new AppError('UNAUTHORIZED');
    }
    if (isPublic && !optional) return true;

    const claims = await this.tokens.verifyAccess(token);
    req.user = { id: claims.id, roles: claims.roles };
    req.sessionFamily = claims.sessionFamily;

    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES, targets);
    if (required?.length) {
      const privileged = claims.roles.includes('admin') || claims.roles.includes('super_admin');
      if (!privileged && !required.some((r) => claims.roles.includes(r))) throw new AppError('FORBIDDEN');
    }
    return true;
  }
}
