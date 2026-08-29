import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '@src/common/common.module';

const WEBHOOK_TTL_SECONDS = 24 * 60 * 60;
const MAX_SKEW_MS = 5 * 60 * 1000;

@Injectable()
export class IdempotencyService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  isTimestampFresh(timestampValue: number, nowMs = Date.now()): boolean {
    if (!Number.isFinite(timestampValue)) return false;
    // Twenty sends milliseconds; legacy tests used seconds
    const timestampMs = timestampValue > 1_000_000_000_000 ? timestampValue : timestampValue * 1000;
    const age = nowMs - timestampMs;
    return age >= 0 && age <= MAX_SKEW_MS;
  }

  /**
   * Returns true if this webhookId was already seen (duplicate).
   * Marks unseen IDs as processed with 24h TTL.
   */
  async hasSeenOrMark(webhookId: string): Promise<boolean> {
    const key = `webhook:${webhookId}`;
    const result = await this.redis.set(key, '1', 'EX', WEBHOOK_TTL_SECONDS, 'NX');
    // SET NX returns null if key already exists
    return result === null;
  }
}
