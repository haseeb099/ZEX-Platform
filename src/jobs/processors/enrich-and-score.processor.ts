import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@src/common/logger/logger.service';
import { PrismaService } from '@src/common/prisma/prisma.service';
import { AuditService } from '@src/audit/audit.service';
import { EnrichmentService } from '@src/enrichment/enrichment.service';
import { ScoringService } from '@src/scoring/scoring.service';
import { TwentyClient } from '@src/twenty/twenty.client';
import { TwentyPerson } from '@src/twenty/twenty.types';
import { ENRICH_AND_SCORE_QUEUE } from '../jobs.constants';
import { CRM_WRITE_ACTIONS, JobActionCheckpointService } from '../job-action-checkpoint.service';

type EnrichJobData = {
  tenantId: string;
  personTwentyId: string;
  event: string;
  webhookLogId: string;
  personSnapshot?: {
    id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    jobTitle?: string;
    [key: string]: unknown;
  } | null;
};

@Injectable()
@Processor(ENRICH_AND_SCORE_QUEUE)
export class EnrichAndScoreProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enrichment: EnrichmentService,
    private readonly scoring: ScoringService,
    private readonly twenty: TwentyClient,
    private readonly audit: AuditService,
    private readonly logger: LoggerService,
    private readonly config: ConfigService,
    private readonly checkpoints: JobActionCheckpointService,
  ) {
    super();
  }

  /**
   * Explicit opt-in only. Default false — CRM read failures must propagate to BullMQ.
   * Never infer fallback from error shape.
   */
  private allowTwentySnapshotFallback(): boolean {
    return this.config.get<boolean>('ALLOW_TWENTY_SNAPSHOT_FALLBACK') === true;
  }

  async process(job: Job<EnrichJobData>) {
    const { tenantId, personTwentyId, webhookLogId } = job.data;

    await this.prisma.webhookLog.update({
      where: { id: webhookLogId },
      data: { status: 'processing', attempts: job.attemptsMade + 1 },
    });

    try {
      const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

      const snapshot = job.data.personSnapshot;
      let person: TwentyPerson;
      try {
        person = await this.twenty.getPerson(tenantId, personTwentyId);
      } catch (err) {
        if (!this.allowTwentySnapshotFallback()) {
          throw err;
        }
        this.logger.warn(
          `Twenty GetPerson failed; using webhook snapshot because ALLOW_TWENTY_SNAPSHOT_FALLBACK=true: ${(err as Error).message}`,
          'EnrichAndScore',
        );
        person = {
          id: personTwentyId,
          firstName: snapshot?.firstName || 'Unknown',
          lastName: snapshot?.lastName || 'Lead',
          email: snapshot?.email,
          jobTitle: snapshot?.jobTitle,
          updatedAt: new Date().toISOString(),
        };
      }

      const enrichmentData = await this.enrichment.enrichPerson(tenantId, person);
      const { score, factors, ruleName } = await this.scoring.score(
        tenantId,
        person,
        enrichmentData,
      );

      // Required CRM writes — failures must propagate (no warn-and-continue).
      // Checkpoints skip actions already confirmed successful for this webhook event.
      const updateDone = await this.checkpoints.getCompleted(
        tenantId,
        webhookLogId,
        CRM_WRITE_ACTIONS.UPDATE_PERSON,
      );
      if (!updateDone.completed) {
        await this.twenty.updatePerson(tenantId, personTwentyId, {
          jobTitle: enrichmentData.jobTitle || person.jobTitle || undefined,
          companyId: person.company?.id,
        });
        await this.checkpoints.recordSuccess(
          tenantId,
          webhookLogId,
          personTwentyId,
          CRM_WRITE_ACTIONS.UPDATE_PERSON,
        );
      }

      const noteDone = await this.checkpoints.getCompleted(
        tenantId,
        webhookLogId,
        CRM_WRITE_ACTIONS.CREATE_NOTE,
      );
      if (!noteDone.completed) {
        await this.twenty.createNote(tenantId, {
          personId: personTwentyId,
          text: `AI Automation: Score ${score}/100 (${Object.entries(factors)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ')})`,
        });
        await this.checkpoints.recordSuccess(
          tenantId,
          webhookLogId,
          personTwentyId,
          CRM_WRITE_ACTIONS.CREATE_NOTE,
        );
      }

      let opportunityCreated = false;
      let opportunityTwentyId: string | undefined;
      const shouldCreateOpp =
        tenant.enableAutoOpportunity &&
        process.env.FEATURE_AUTO_OPPORTUNITY !== 'false' &&
        score >= tenant.opportunityThreshold;

      if (shouldCreateOpp) {
        const oppDone = await this.checkpoints.getCompleted(
          tenantId,
          webhookLogId,
          CRM_WRITE_ACTIONS.CREATE_OPPORTUNITY,
        );
        if (!oppDone.completed) {
          const opp = await this.twenty.createOpportunity(tenantId, {
            personId: personTwentyId,
            name: `${person.firstName || 'Lead'} - Auto-qualified`,
            stage: 'prospect',
            probability: Math.round(score / 10),
          });
          await this.checkpoints.recordSuccess(
            tenantId,
            webhookLogId,
            personTwentyId,
            CRM_WRITE_ACTIONS.CREATE_OPPORTUNITY,
            opp.id,
          );
          opportunityCreated = true;
          opportunityTwentyId = opp.id;
        } else {
          opportunityCreated = true;
          opportunityTwentyId = oppDone.externalId;
        }
      }

      await this.prisma.scoreHistory.create({
        data: {
          tenantId,
          personTwentyId,
          personName: [person.firstName, person.lastName].filter(Boolean).join(' ') || null,
          personEmail: person.email || enrichmentData.personEmail || null,
          score,
          factors,
          ruleName,
          opportunityCreated,
          opportunityTwentyId,
        },
      });

      // success:true only after required CRM writes (and opportunity when required) committed.
      await this.audit.log({
        tenantId,
        action: 'enrich_and_score_person',
        resourceType: 'Person',
        resourceTwentyId: personTwentyId,
        before: person as object,
        after: { ...enrichmentData, score, factors, opportunityCreated },
        triggeredBy: `job:${job.name}`,
        webhookLogId,
        success: true,
      });

      await this.prisma.webhookLog.update({
        where: { id: webhookLogId },
        data: {
          status: 'success',
          processedAt: new Date(),
          jobResult: { score, factors, opportunityCreated },
        },
      });

      return { score, factors, opportunityCreated };
    } catch (err) {
      const message = (err as Error).message;
      await this.prisma.webhookLog.update({
        where: { id: webhookLogId },
        data: { status: 'failed', error: message },
      });
      throw err;
    }
  }
}
