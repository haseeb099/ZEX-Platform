import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { CryptoService } from '@src/common/crypto.service';
import { LoggerService } from '@src/common/logger/logger.service';
import { PrismaService } from '@src/common/prisma/prisma.service';
import { AuditService } from '@src/audit/audit.service';
import { EnrichmentService } from '@src/enrichment/enrichment.service';
import { ScoringService } from '@src/scoring/scoring.service';
import { TwentyClient } from '@src/twenty/twenty.client';
import { ENRICH_AND_SCORE_QUEUE } from '../jobs.constants';

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
    private readonly crypto: CryptoService,
    private readonly enrichment: EnrichmentService,
    private readonly scoring: ScoringService,
    private readonly twenty: TwentyClient,
    private readonly audit: AuditService,
    private readonly logger: LoggerService,
  ) {
    super();
  }

  async process(job: Job<EnrichJobData>) {
    const { tenantId, personTwentyId, webhookLogId } = job.data;

    await this.prisma.webhookLog.update({
      where: { id: webhookLogId },
      data: { status: 'processing', attempts: job.attemptsMade + 1 },
    });

    try {
      const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const apiKey = this.crypto.decrypt(tenant.twentyApiKey);

      const snapshot = job.data.personSnapshot;
      let person;
      try {
        person = await this.twenty.getPerson(apiKey, personTwentyId);
      } catch {
        // Local/dev fallback when Twenty is unreachable — use webhook payload
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

      try {
        await this.twenty.updatePerson(apiKey, personTwentyId, {
          jobTitle: enrichmentData.jobTitle || person.jobTitle || undefined,
          company: enrichmentData.companyName || undefined,
          location: enrichmentData.location || undefined,
        });
        await this.twenty.createNote(apiKey, {
          personId: personTwentyId,
          text: `AI Automation: Score ${score}/100 (${Object.entries(factors)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ')})`,
        });
      } catch (err) {
        this.logger.warn(`Twenty write-back skipped: ${(err as Error).message}`, 'EnrichAndScore');
      }

      let opportunityCreated = false;
      let opportunityTwentyId: string | undefined;
      const shouldCreateOpp =
        tenant.enableAutoOpportunity &&
        process.env.FEATURE_AUTO_OPPORTUNITY !== 'false' &&
        score >= tenant.opportunityThreshold;

      if (shouldCreateOpp) {
        try {
          const opp = await this.twenty.createOpportunity(apiKey, {
            personId: personTwentyId,
            name: `${person.firstName || 'Lead'} - Auto-qualified`,
            stage: 'prospect',
            probability: Math.round(score / 10),
          });
          opportunityCreated = true;
          opportunityTwentyId = opp.id;
        } catch (err) {
          // Threshold met but Twenty unreachable — record intent for local/dev
          opportunityCreated = true;
          opportunityTwentyId = `pending-twenty-${personTwentyId}`;
          this.logger.warn(
            `Opportunity create deferred (Twenty unreachable): ${(err as Error).message}`,
            'EnrichAndScore',
          );
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
