---
name: lead-scoring-explainable
description: >-
  Implement explainable 0–100 lead scoring, ScoringRule priority matching, and
  auto-opportunity creation when score meets tenant threshold for ZEX Connect.
---

# Lead Scoring (Explainable)

## Rules

- Score clamped 0–100 with explicit `factors` object.
- First matching enabled `ScoringRule` by priority wins.
- Persist every run to `ScoreHistory`.
- Auto-create Opportunity only if `score >= tenant.opportunityThreshold` and feature enabled.
- Write a Twenty Note with score + factor summary.
- Unit-test title/company/industry/recency factor paths.
