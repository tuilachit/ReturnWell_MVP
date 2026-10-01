import { pilotEvidence, type PilotEvidence } from "./release-evidence.ts";
type Env = Record<string, string | undefined>;
export type ReleaseMode = "private_test" | "pilot";
export function validateReleaseConfig(
  env: Env,
  evidence: PilotEvidence = pilotEvidence,
): { mode: ReleaseMode; ready: boolean; blockers: string[] } {
  const requested = env.RELEASE_MODE ?? "private_test",
    blockers: string[] = [];
  if (!["private_test", "pilot"].includes(requested))
    return {
      mode: "private_test",
      ready: false,
      blockers: ["unknown_release_mode"],
    };
  if (requested === "private_test")
    return { mode: "private_test", ready: true, blockers };
  if (!evidence.approvalReference) blockers.push("pilot_approval_required");
  if (
    !evidence.noticesPublished ||
    !evidence.termsVersion ||
    !evidence.privacyVersion ||
    evidence.termsVersion !== env.TERMS_VERSION ||
    evidence.privacyVersion !== env.PRIVACY_VERSION
  )
    blockers.push("reviewed_notices_required");
  if (
    !evidence.businessName ||
    evidence.businessName !== env.RETURNWELL_BUSINESS_NAME
  )
    blockers.push("reviewed_identity_required");
  if (
    !evidence.supportEmail ||
    evidence.supportEmail !== env.SUPPORT_EMAIL ||
    !/^\S+@\S+\.\S+$/.test(evidence.supportEmail)
  )
    blockers.push("reviewed_support_required");
  for (const key of [
    "clinicalProtocol",
    "privacyReview",
    "retentionReview",
    "recoveryRehearsal",
    "monitoringOwner",
    "mailboxAcceptance",
    "directAuthAbuseReview",
  ] as const)
    if (!evidence[key]) blockers.push(key + "_required");
  return { mode: "pilot", ready: blockers.length === 0, blockers };
}
export function publicReleaseInfo(env: Env) {
  const state = validateReleaseConfig(env);
  const mode = state.ready ? state.mode : "private_test";
  return {
    mode,
    label: mode === "pilot" ? "Invitation-only pilot" : "Private test",
  };
}
export function deliveryPermitted(env: Env) {
  if (
    env.EMAIL_DELIVERY_ENABLED !== "true" ||
    env.RESTORE_QUARANTINE === "true" ||
    !validateReleaseConfig(env).ready
  )
    return false;
  // The two-doctor pilot is also bounded. An empty restriction never means everyone.
  const recipients = (env.EMAIL_TEST_ALLOWLIST ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return (
    recipients.length > 0 &&
    recipients.length <= 100 &&
    recipients.every(
      (x) => x.length <= 254 && /^[^\s@*]+@[^\s@*]+\.[^\s@*]+$/.test(x),
    )
  );
}
