import { assessIcpFit } from '@src/prospect-discovery/fit-scoring';
import type { ProspectDiscoveryIcpInput } from '@src/prospect-discovery/prospect-discovery.types';
import { signalMatchesBuyingTrigger } from './buying-trigger-match';
import { clampConfidence, clampScore, daysBetween, timingDecayFactor } from './signal-utils';
import {
  ScoreReason,
  WHY_NOW_SCORING_VERSION,
  WHY_NOW_WEIGHTS,
  WhyNowAssessment,
} from './why-now.types';

export type WhyNowSignalInput = {
  id?: string;
  signalType: string;
  category: string;
  title: string;
  summary?: string | null;
  source: string;
  occurredAt: Date;
  confidence: number;
  relevance: number;
};

export type WhyNowCandidateInput = {
  companyName: string;
  industry?: string | null;
  companySize?: string | null;
  geography?: string | null;
  description?: string | null;
};

/**
 * Deterministic Why-Now scorer.
 * Reuses assessIcpFit for fit; intent/timing from typed signals only (no invented evidence).
 */
export function assessWhyNow(input: {
  brain: ProspectDiscoveryIcpInput;
  candidate: WhyNowCandidateInput;
  signals: WhyNowSignalInput[];
  now?: Date;
}): WhyNowAssessment {
  const now = input.now ?? new Date();
  const fit = assessIcpFit(input.brain, input.candidate);
  const fitReasons: ScoreReason[] = fit.fitReasons.map(r => ({
    type: r.type === 'rule' ? 'rule' : r.type,
    label: r.label,
    detail: r.detail,
    field: r.field,
  }));

  const buyingTriggers = input.brain.icp.buyingTriggers.map(t => t.toLowerCase());
  const intentReasons: ScoreReason[] = [];
  const timingReasons: ScoreReason[] = [];

  let intent = 15; // neutral baseline when no signals
  let timing = 10;
  let conflictCount = 0;
  let positiveSignalCount = 0;
  let triggerMatchCount = 0;
  let freshnessSum = 0;

  if (!input.signals.length) {
    intentReasons.push({
      type: 'neutral',
      label: 'No intent signals available',
      detail: 'Intent remains low/neutral without provenance-backed activity',
    });
    timingReasons.push({
      type: 'neutral',
      label: 'No timing signals available',
      detail: 'Timing stays low until a dated signal is observed',
    });
  }

  for (const signal of input.signals) {
    const ageDays = daysBetween(now, signal.occurredAt);
    const decay = timingDecayFactor(ageDays);
    const polarity =
      signal.category === 'negative' || signal.signalType === 'disqualifier_conflict' ? -1 : 1;

    const knownTrigger = signalMatchesBuyingTrigger(signal, buyingTriggers);

    const intentDelta =
      polarity * (30 + (knownTrigger ? 28 : 8)) * signal.confidence * signal.relevance;
    intent += intentDelta;

    const timingBase = knownTrigger ? 65 : 40;
    const timingDelta = polarity * timingBase * decay * signal.confidence * signal.relevance;
    timing += timingDelta;

    if (polarity < 0) {
      conflictCount += 1;
      intentReasons.push({
        type: 'conflict',
        label: `Negative signal: ${signal.title}`,
        detail: signal.summary ?? undefined,
        signalId: signal.id,
        weight: intentDelta,
      });
      timingReasons.push({
        type: 'conflict',
        label: `Negative timing contribution from ${signal.title}`,
        signalId: signal.id,
        weight: timingDelta,
      });
    } else {
      positiveSignalCount += 1;
      if (knownTrigger) triggerMatchCount += 1;
      intentReasons.push({
        type: 'positive',
        label: knownTrigger
          ? `Buying-trigger aligned signal: ${signal.title}`
          : `Intent signal: ${signal.title}`,
        detail: signal.summary ?? `source=${signal.source}`,
        signalId: signal.id,
        weight: intentDelta,
      });
      timingReasons.push({
        type: decay < 1 ? 'decay' : 'positive',
        label:
          decay < 1
            ? `Timing decayed for ${signal.title} (age ${Math.round(ageDays)}d, factor ${decay})`
            : `Fresh signal timing: ${signal.title} (age ${Math.round(ageDays)}d)`,
        detail: `occurredAt=${signal.occurredAt.toISOString()}`,
        signalId: signal.id,
        weight: timingDelta,
      });
    }

    freshnessSum += decay;
  }

  // Disqualified ICP strongly caps overall prioritization via fit; also dampen intent enthusiasm
  if (fit.disqualifiers.length) {
    intent = Math.min(intent, 40);
    intentReasons.push({
      type: 'negative',
      label: 'Intent capped due to ICP disqualifiers',
      detail: fit.disqualifiers.join(', '),
    });
  }

  const fitScore = clampScore(fit.fitScore);
  const intentScore = clampScore(intent);
  const timingScore = clampScore(timing);
  const overallScore = clampScore(
    fitScore * WHY_NOW_WEIGHTS.fit +
      intentScore * WHY_NOW_WEIGHTS.intent +
      timingScore * WHY_NOW_WEIGHTS.timing,
  );

  // Confidence is distinct from overall score
  let confidence = 0.35;
  if (input.signals.length === 0) {
    confidence = fitScore >= 55 ? 0.4 : 0.3;
  } else {
    const avgSourceConf =
      input.signals.reduce((s, x) => s + x.confidence, 0) / input.signals.length;
    const avgFreshness = freshnessSum / input.signals.length;
    confidence =
      0.45 +
      Math.min(0.25, positiveSignalCount * 0.08) +
      avgSourceConf * 0.2 +
      avgFreshness * 0.1 +
      (triggerMatchCount > 0 ? 0.08 : 0);
    if (conflictCount > 0) confidence -= 0.15 * conflictCount;
    if (fit.disqualifiers.length) confidence -= 0.1;
  }
  confidence = clampConfidence(confidence);

  const whyNow = buildWhyNowExplanation({
    candidate: input.candidate,
    fitScore,
    intentScore,
    timingScore,
    fitReasons,
    intentReasons,
    timingReasons,
    disqualifiers: fit.disqualifiers,
    signals: input.signals,
    triggerMatchCount,
  });

  return {
    fitScore,
    intentScore,
    timingScore,
    overallScore,
    confidence,
    whyNow,
    fitReasons,
    intentReasons,
    timingReasons,
    signalIds: input.signals.map(s => s.id).filter((id): id is string => Boolean(id)),
    scoringVersion: WHY_NOW_SCORING_VERSION,
  };
}

function buildWhyNowExplanation(input: {
  candidate: WhyNowCandidateInput;
  fitScore: number;
  intentScore: number;
  timingScore: number;
  fitReasons: ScoreReason[];
  intentReasons: ScoreReason[];
  timingReasons: ScoreReason[];
  disqualifiers: string[];
  signals: WhyNowSignalInput[];
  triggerMatchCount: number;
}): string {
  const parts: string[] = [];
  const company = input.candidate.companyName;

  if (input.disqualifiers.length) {
    parts.push(
      `${company} shows activity but is a weak ICP fit due to: ${input.disqualifiers.slice(0, 2).join(', ')}.`,
    );
  } else if (input.fitScore >= 75) {
    const bits = [input.candidate.companySize, input.candidate.industry, input.candidate.geography]
      .filter(Boolean)
      .slice(0, 3);
    parts.push(
      bits.length
        ? `Strong ICP fit: ${bits.join(' · ')} company (${company}).`
        : `Strong ICP fit for ${company}.`,
    );
  } else if (input.fitScore >= 55) {
    parts.push(`Moderate ICP fit for ${company}.`);
  } else {
    parts.push(`Limited ICP fit for ${company}.`);
  }

  if (!input.signals.length) {
    parts.push('No recent intent signals are available, so timing to engage is not supported yet.');
  } else if (input.disqualifiers.length && input.intentScore >= 40) {
    parts.push('Recent signals exist, but prioritization stays low until fit improves.');
  } else if (input.triggerMatchCount > 0 && input.timingScore >= 55) {
    const sig = input.signals.find(s => s.category !== 'negative') || input.signals[0];
    parts.push(
      `A ${sig.signalType.replace(/_/g, ' ')} signal (${sig.title}) aligns with Company Brain buying triggers, making outreach timely now.`,
    );
  } else if (input.timingScore < 35 && input.intentScore >= 40) {
    parts.push('Relevant signals exist but are stale, so timing contribution is reduced.');
  } else if (input.intentScore < 30) {
    parts.push('Intent evidence is sparse; Why-Now prioritization remains cautious.');
  } else {
    parts.push('Mixed intent/timing evidence yields a measured Why-Now priority.');
  }

  return parts.slice(0, 3).join(' ');
}
