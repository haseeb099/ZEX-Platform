---
name: webhook-security-hardening
description: >-
  Implement or review Twenty webhook HMAC verification, idempotency, timestamp
  skew checks, and fail-closed security for ZEX Connect webhook receiver.
---

# Webhook Security Hardening

## Non-negotiables

1. HMAC with `crypto.timingSafeEqual` (constant-time).
2. Sign the **raw body**, not re-serialized JSON.
3. Reject timestamps older than 5 minutes.
4. Idempotent `x-twenty-webhook-id` in Redis (TTL 24h).
5. Return **200** immediately after verify + enqueue.
6. Bad signature → **401**; unknown tenant → **404**.
7. Per-tenant rate limits via Redis.

## Reference

Handoff §7 Webhook & Event Handling; scaffold webhook modules.
