const messages: Record<string, string> = {
  unauthorized: "Your session ended. Sign in again to continue.",
  denied:
    "Your access changed. Reopen your workspace or contact your practice administrator.",
  request_failed:
    "The request could not be confirmed. Check your connection and retry the same action.",
  network_error:
    "The request could not be confirmed. Check your connection and retry the same action.",
  rate_limited: "Please wait before trying again.",
  conflict:
    "This record changed. Your edits are retained. Reload the saved version before trying again.",
  terms_changed:
    "The terms or privacy notice changed. Load the current saved version, review the linked notices, and confirm consent again. Your profile edits are retained.",
  invitation_unavailable:
    "This invitation is no longer available. Ask your inviter for a new invitation.",
  sender_configuration:
    "Invitation delivery is not configured yet. Contact ReturnWell support.",
  reviewed_identity_required:
    "ReturnWell needs to review your inviter identity before you can invite someone.",
  recipient_suppressed:
    "Invitations to this address are paused. Contact ReturnWell support.",
  step_up_required:
    "Verify your authenticator in Account security before this action. Your edits are retained.",
  verified_owner_required:
    "Use an existing account with a verified email address for the practice owner.",
  last_owner:
    "Another independently reviewed owner is required before removing the last active owner.",
  invalid_cursor:
    "This page no longer matches your filters. Return to the first page.",
  geography_unavailable:
    "Distance filtering is not configured. Browse by suburb or appointment format.",
  invalid_location:
    "This suburb no longer matches the postcode reference. Refresh the location options and choose again.",
  invalid_radius:
    "Choose a valid radius between 0 and 500 km, excluding zero.",
  location_required:
    "This suburb has no usable reference coordinates. Refresh the location options or browse without distance.",
  credential_policy_required:
    "This profession needs an approved verification and review policy before activation.",
  evidence_required:
    "Complete the independent identity and registration checks.",
  invalid_profile: "Please check the profile details.",
  invalid_draft: "Please check the referral fields. Your edits are retained.",
  recipient_ineligible:
    "This practitioner no longer meets the referral requirements. Review your selection.",
  consent_required: "Please confirm the required consent.",
  body_too_large: "This form is too large. Shorten the fields and try again.",
  invalid_request: "Please check the fields and try again.",
  origin_denied:
    "This application address is not configured for secure access.",
};
export class WorkflowError extends Error {
  code: string;
  status: number | null;
  retryAfterSeconds: number | null;
  fieldErrors: Record<string, string>;
  constructor(
    message: string,
    code: string,
    status: number | null,
    retryAfterSeconds: number | null = null,
    fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.fieldErrors = fieldErrors;
  }
}
const definitiveCodes = new Set([
  "unauthorized",
  "denied",
  "rate_limited",
  "conflict",
  "terms_changed",
  "invitation_unavailable",
  "reviewed_identity_required",
  "recipient_suppressed",
  "step_up_required",
  "verified_owner_required",
  "last_owner",
  "invalid_cursor",
  "geography_unavailable",
  "invalid_location",
  "invalid_radius",
  "location_required",
  "credential_policy_required",
  "evidence_required",
  "invalid_profile",
  "invalid_draft",
  "recipient_ineligible",
  "consent_required",
  "body_too_large",
  "invalid_request",
  "origin_denied",
]);
// A stale cursor can also be caused by a newly activated reference edition.
export function needsGeographyRefresh(code: string): boolean {
  return ["invalid_location", "invalid_radius", "location_required", "geography_unavailable", "invalid_cursor"].includes(code);
}
// An unfamiliar 4xx can be an intermediary/older server's ambiguous failure.
// Only explicit known pre-commit rejections may release a first-attempt ID.
export function isDefinitiveWorkflowFailure(
  error: unknown,
): error is WorkflowError {
  return (
    error instanceof WorkflowError &&
    error.status !== null &&
    error.status >= 400 &&
    error.status < 500 &&
    definitiveCodes.has(error.code)
  );
}
export function workflowFailure(
  code: string,
  status: number | null = null,
  retryAfterSeconds: number | null = null,
) {
  const safeCode = Object.hasOwn(messages, code) ? code : "request_failed";
  return new WorkflowError(
    messages[safeCode],
    safeCode,
    status,
    retryAfterSeconds,
  );
}
export function retryAfterSeconds(
  value: string | null,
  now = Date.now(),
): number | null {
  if (!value) return null;
  const seconds = /^\d+$/.test(value.trim())
    ? Number(value)
    : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds)
    ? Math.min(86400, Math.max(0, Math.ceil(seconds)))
    : null;
}
export async function parseWorkflowFailure(
  response: Response,
): Promise<WorkflowError> {
  const payload = await response.json().catch(() => null);
  const code =
    typeof payload?.code === "string" && Object.hasOwn(messages, payload.code)
      ? payload.code
      : response.status === 401
        ? "unauthorized"
        : response.status === 403
          ? "denied"
          : response.status === 409
            ? "conflict"
            : response.status === 429
              ? "rate_limited"
              : "request_failed";
  // Raw server messages/field values may contain database or clinical details.
  return workflowFailure(
    code,
    response.status,
    retryAfterSeconds(response.headers.get("retry-after")),
  );
}
