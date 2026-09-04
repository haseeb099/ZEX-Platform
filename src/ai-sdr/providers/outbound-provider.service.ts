import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MEETING_PROVIDER,
  MeetingProvider,
  OUTBOUND_MESSAGE_PROVIDER,
  OutboundMessageProvider,
  OutboundSendInput,
  OutboundSendResult,
  MeetingProposeInput,
  MeetingProposeResult,
  MeetingConfirmInput,
  MeetingConfirmResult,
} from '../ai-sdr.types';
import {
  DeterministicMeetingProvider,
  DeterministicOutboundProvider,
} from './deterministic.provider';

@Injectable()
export class OutboundMessageProviderService {
  constructor(
    private readonly config: ConfigService,
    private readonly deterministic: DeterministicOutboundProvider,
    @Optional()
    @Inject(OUTBOUND_MESSAGE_PROVIDER)
    private readonly production?: OutboundMessageProvider,
  ) {}

  private provider(): OutboundMessageProvider {
    const useDet =
      this.config.get<boolean>('AI_SDR_DETERMINISTIC') === true ||
      this.config.get<string>('NODE_ENV') === 'test' ||
      !this.production;
    return useDet ? this.deterministic : this.production!;
  }

  sendEmail(input: OutboundSendInput): Promise<OutboundSendResult> {
    return this.provider().sendEmail(input);
  }

  /** Test helper — only meaningful for deterministic provider. */
  getDeterministic(): DeterministicOutboundProvider {
    return this.deterministic;
  }
}

@Injectable()
export class MeetingProviderService {
  constructor(
    private readonly config: ConfigService,
    private readonly deterministic: DeterministicMeetingProvider,
    @Optional()
    @Inject(MEETING_PROVIDER)
    private readonly production?: MeetingProvider,
  ) {}

  private provider(): MeetingProvider {
    const useDet =
      this.config.get<boolean>('AI_SDR_DETERMINISTIC') === true ||
      this.config.get<string>('NODE_ENV') === 'test' ||
      !this.production;
    return useDet ? this.deterministic : this.production!;
  }

  propose(input: MeetingProposeInput): Promise<MeetingProposeResult> {
    return this.provider().propose(input);
  }

  confirm(input: MeetingConfirmInput): Promise<MeetingConfirmResult> {
    return this.provider().confirm(input);
  }
}
