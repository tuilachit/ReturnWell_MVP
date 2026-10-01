# Operational incident runbook — pilot activation blocked

Named owner, deputy, escalation destination, support hours, provider log retention and cost ceiling: **not approved/configured**. No external alert delivery has been claimed or tested.

Implemented: operator-only `/admin/email` shows queue size, oldest due age, auth overdue count, review/failed/paused counts and last completed dispatcher. Fixed-size service-only heartbeat/error counters and allowlisted host log events carry no email, patient text, raw exception, URL/query, token or provider body. Suggested warnings: no completed heartbeat for 5 minutes, auth due >2 minutes, other pending >5 minutes, any review-needed job, two persistence failures in a 5-minute window. They are internal warnings, not SLAs. `changedAlerts` allows an approved sink to deduplicate unchanged codes; no sink is connected yet.

1. Verify current operator access and exact environment. Do not use a clinical screen as an admin backdoor.
2. Read queue health and host status. Never press a new-send workaround or change an idempotency key for uncertainty.
3. For provider/configuration outage, keep delivery disabled, retain saved clinical work and tell the referring practice through the approved support route without patient content.
4. Reconcile each uncertain job against provider acceptance and signed persisted callback; a sent receipt is not inbox placement or a recipient response. Revoked links and cancelled referrals remain unavailable even after late delivery.
5. For suspected disclosure, suspend the relevant access via the reviewed privileged workflow, preserve evidence and involve the named privacy/security owner. Do not purge records or paste payloads into logs/tickets.
6. Recovery/resumption requires the exact approved source, configuration and recipient boundary, provider reconciliation and separate owner approval. Record a redacted incident timeline and follow-up review.

Local fault checks cover unresponsive provider, malformed acceptance, 429/backoff, cancellation during transport, callbacks before receipt, persistence failure (503), current-role denial and queue-health reads without sends. Hosted cron liveness, actual alert reception/acknowledgement, mailbox placement and human incident drills remain launch gates.
