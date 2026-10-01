export type EmailDeliverySummary = {
  state:
    | "pending"
    | "sent"
    | "delivered"
    | "delayed"
    | "suppressed"
    | "failed"
    | "configuration_needed"
    | "needs_review"
    | "cancelled"
    | "unknown";
  updatedAt: string | null;
  nextRetryAt: string | null;
};
export type InvitationProgress = {
  invitationId: string;
  status: string;
  expiresAt: string;
  generation: number;
  signupCompletedAt: string | null;
  accountWasNew: boolean | null;
  delivery: EmailDeliverySummary;
};
export function invitationProgressLabel(
  progress: InvitationProgress,
  now = Date.now(),
): string {
  if (progress.status === "claimed") {
    if (progress.accountWasNew === false) return "Existing account confirmed";
    if (progress.accountWasNew === true) return "New account confirmed";
    return "Account confirmed";
  }
  if (progress.status === "revoked") return "Invitation revoked";
  if (progress.status === "declined") return "Invitation declined";
  if (Date.parse(progress.expiresAt) <= now)
    return "Invitation expired — create a new invitation with permission";
  return "Waiting for mailbox confirmation";
}
export function deliveryProgressLabel(delivery: EmailDeliverySummary): string {
  const labels: Record<EmailDeliverySummary["state"], string> = {
    pending: "Email queued — not yet sent",
    sent: "Email sent — delivery not yet confirmed",
    delivered: "Email delivered — this does not mean read",
    delayed: "Email delivery delayed",
    suppressed: "Email suppressed — contact support before sending again",
    failed: "Email failed — needs attention",
    configuration_needed: "Email paused — delivery configuration needed",
    needs_review: "Email outcome uncertain — needs operator review",
    cancelled: "Email cancelled",
    unknown: "Email status unavailable",
  };
  return labels[delivery.state] || labels.unknown;
}
