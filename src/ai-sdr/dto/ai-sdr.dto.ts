import { IsBoolean, IsEmail, IsIn, IsOptional, IsString } from 'class-validator';
import { OutboundFixture, ReplyClassification } from '../ai-sdr.types';

export class CreateSdrSequenceDto {
  @IsOptional()
  @IsEmail()
  targetEmail?: string;

  @IsOptional()
  @IsString()
  targetPersonTwentyId?: string;

  @IsOptional()
  @IsString()
  targetPersonName?: string;

  @IsOptional()
  @IsBoolean()
  generateDraft?: boolean;
}

export class CreateSdrDraftDto {
  @IsOptional()
  @IsIn(['outreach', 'follow_up', 'reply', 'meeting'])
  purpose?: 'outreach' | 'follow_up' | 'reply' | 'meeting';
}

export class ApproveSdrDraftDto {
  @IsOptional()
  @IsString()
  approvedBy?: string;
}

export class SendSdrDraftDto {
  @IsOptional()
  @IsBoolean()
  sync?: boolean;

  @IsOptional()
  @IsIn(['success', 'transient_failure', 'permanent_failure'])
  fixture?: OutboundFixture;

  /** When true, only retries CRM sync for an already-sent message (no provider send). */
  @IsOptional()
  @IsBoolean()
  crmSyncOnly?: boolean;
}

export class IngestReplyDto {
  @IsString()
  providerEventId!: string;

  @IsOptional()
  @IsString()
  providerMessageId?: string;

  @IsOptional()
  @IsString()
  sequenceId?: string;

  @IsOptional()
  @IsIn(['POSITIVE', 'NEGATIVE', 'QUESTION', 'NOT_NOW', 'OOO', 'UNSUBSCRIBE', 'UNKNOWN'])
  classification?: ReplyClassification;

  @IsOptional()
  @IsString()
  sender?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  bodySummary?: string;
}

export class ConfirmMeetingDto {
  @IsOptional()
  @IsBoolean()
  sync?: boolean;
}
