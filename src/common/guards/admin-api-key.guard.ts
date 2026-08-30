import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyRequest } from 'fastify';
import { secureCompareStrings } from '@src/common/secure-compare';

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const expected = this.config.getOrThrow<string>('ADMIN_API_KEY');
    if (!token || !secureCompareStrings(token, expected)) {
      throw new UnauthorizedException('Invalid admin API key');
    }
    return true;
  }
}
