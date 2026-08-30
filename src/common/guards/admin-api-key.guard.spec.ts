import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminApiKeyGuard } from './admin-api-key.guard';

describe('AdminApiKeyGuard', () => {
  const adminKey = 'admin_key_with_minimum_thirty_two_characters_long';

  function buildGuard(header?: string) {
    const config = {
      getOrThrow: (key: string) => {
        if (key === 'ADMIN_API_KEY') return adminKey;
        throw new Error(key);
      },
    } as ConfigService;

    const guard = new AdminApiKeyGuard(config);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: header ? { authorization: header } : {},
        }),
      }),
    };
    return { guard, context: context as never };
  }

  it('denies when admin key header is missing', () => {
    const { guard, context } = buildGuard();
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    try {
      guard.canActivate(context);
    } catch (err) {
      expect((err as UnauthorizedException).message).toBe('Invalid admin API key');
      expect(JSON.stringify(err)).not.toContain(adminKey);
    }
  });

  it('denies when admin key is wrong', () => {
    const { guard, context } = buildGuard('Bearer wrong_admin_key_with_minimum_length_123456');
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    try {
      guard.canActivate(context);
    } catch (err) {
      expect(JSON.stringify(err)).not.toContain('wrong_admin_key');
    }
  });

  it('allows when admin key is correct', () => {
    const { guard, context } = buildGuard(`Bearer ${adminKey}`);
    expect(guard.canActivate(context)).toBe(true);
  });
});
