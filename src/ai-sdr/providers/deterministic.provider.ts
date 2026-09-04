import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  MeetingConfirmInput,
  MeetingConfirmResult,
  MeetingProposeInput,
  MeetingProposeResult,
  MeetingProvider,
  OutboundFixture,
  OutboundMessageProvider,
  OutboundSendInput,
  OutboundSendResult,
} from '../ai-sdr.types';

/**
 * Deterministic outbound email provider for CI/staging — never sends real email.
 * Tracks call counts in-memory for idempotency assertions within a process.
 */
@Injectable()
export class DeterministicOutboundProvider implements OutboundMessageProvider {
  readonly name = 'deterministic-outbound';
  readonly sendCalls: OutboundSendInput[] = [];
  private readonly sentByKey = new Map<string, OutboundSendResult>();

  reset() {
    this.sendCalls.length = 0;
    this.sentByKey.clear();
  }

  async sendEmail(input: OutboundSendInput): Promise<OutboundSendResult> {
    const existing = this.sentByKey.get(input.idempotencyKey);
    if (existing) {
      return existing;
    }

    this.sendCalls.push(input);
    const fixture: OutboundFixture = input.fixture || 'success';
    if (fixture === 'transient_failure') {
      throw new Error('Deterministic outbound transient failure');
    }
    if (fixture === 'permanent_failure') {
      throw new Error('Deterministic outbound permanent failure');
    }

    // Hash full key so distinct sends get distinct providerMessageIds (prefix slice collided).
    const digest = createHash('sha256').update(input.idempotencyKey, 'utf8').digest('hex').slice(0, 24);
    const result: OutboundSendResult = {
      provider: this.name,
      providerMessageId: `det-msg-${digest}`,
    };
    this.sentByKey.set(input.idempotencyKey, result);
    return result;
  }
}

@Injectable()
export class DeterministicMeetingProvider implements MeetingProvider {
  readonly name = 'deterministic-meeting';

  async propose(input: MeetingProposeInput): Promise<MeetingProposeResult> {
    return {
      provider: this.name,
      bookingLink: `https://book.example.test/${input.sequenceId}`,
      proposedTimes: [
        new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      ],
    };
  }

  async confirm(input: MeetingConfirmInput): Promise<MeetingConfirmResult> {
    return {
      provider: this.name,
      providerMeetingId: `det-meet-${input.bookingId.slice(0, 16)}`,
    };
  }
}
