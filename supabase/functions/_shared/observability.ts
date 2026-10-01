const events = [
  "dispatch_started",
  "dispatch_completed",
  "dispatch_failed",
  "webhook_persist_failed",
] as const;
type OperationalEvent = {
  event: (typeof events)[number];
  routeTemplate: "dispatch-email-jobs" | "resend-webhook";
  status: number;
  durationMs: number;
  requestId: string;
  releaseId?: string;
};
export function operationalEvent(
  input: Record<string, unknown>,
): OperationalEvent | null {
  if (
    Object.keys(input).some(
      (k) =>
        ![
          "event",
          "routeTemplate",
          "status",
          "durationMs",
          "requestId",
          "releaseId",
        ].includes(k),
    )
  )
    return null;
  if (
    !events.includes(input.event as (typeof events)[number]) ||
    !["dispatch-email-jobs", "resend-webhook"].includes(
      String(input.routeTemplate),
    ) ||
    !Number.isInteger(input.status) ||
    Number(input.status) < 100 ||
    Number(input.status) > 599 ||
    typeof input.durationMs !== "number" ||
    !Number.isFinite(input.durationMs) ||
    input.durationMs < 0 ||
    input.durationMs > 3600000 ||
    typeof input.requestId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      input.requestId,
    ) ||
    (input.releaseId !== undefined &&
      (typeof input.releaseId !== "string" ||
        !/^[a-f0-9]{7,40}$/.test(input.releaseId)))
  )
    return null;
  return { ...input } as OperationalEvent;
}
export function recordOperationalEvent(
  input: Record<string, unknown>,
  sink: (value: string) => void = console.info,
) {
  const event = operationalEvent(input);
  if (event) sink(JSON.stringify(event));
}
export type QueueHealth = {
  quarantined?: boolean;
  pendingCount: number;
  oldestPendingSeconds: number;
  authOverdueCount: number;
  needsReviewCount: number;
  failedCount: number;
  lastDispatchAt: string | null;
  webhookFailureCount: number;
  pausedCount?: number;
};
export function healthAlerts(health: QueueHealth, now = Date.now()): string[] {
  const alerts: string[] = [];
  if (health.quarantined) alerts.push("restore_quarantined");
  const last = health.lastDispatchAt ? Date.parse(health.lastDispatchAt) : NaN;
  if (!Number.isFinite(last) || now - last > 300000)
    alerts.push("dispatcher_stalled");
  if (health.authOverdueCount > 0) alerts.push("auth_overdue");
  if (health.oldestPendingSeconds > 300) alerts.push("queue_aged");
  if (health.needsReviewCount > 0) alerts.push("delivery_needs_review");
  if (health.webhookFailureCount >= 2)
    alerts.push("webhook_persistence_failed");
  return alerts;
}
// An approved alert sink can persist its last codes; unchanged failures need no
// repeat notification. This helper does not send or invent an incident owner.
export function changedAlerts(previous: string[], current: string[]) {
  return current.filter((code) => !previous.includes(code));
}
