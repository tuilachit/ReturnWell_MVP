import type { SupabaseClient } from "@supabase/supabase-js";
import { invoke } from "./workflow";
export type ReferralGrowth = {
  referralId: string;
  invitationId: string;
  version: number;
  status:
    | "awaiting_signup"
    | "awaiting_review"
    | "needs_reconfirmation"
    | "released"
    | "cancelled";
  reason: string | null;
  consentValidUntil: string;
  releasedAt: string | null;
  invitationStatus: string;
  signupCompletedAt: string | null;
  accountWasNew: boolean | null;
  recipientName: string;
  recipientEmail: string;
  notification: string;
};
export type InviteReferral = {
  id: string;
  expectedVersion: number;
  requestId: string;
  consentConfirmed: true;
  contactConsentConfirmed: true;
  contactBasis: "recipient_requested" | "documented_permission";
  recipientName: string;
  recipientEmail: string;
};
export const inviteReferral = (client: SupabaseClient, input: InviteReferral) =>
  invoke<ReferralGrowth>(client, "manage-referral", {
    operation: "draft.invite",
    ...input,
  });
export const referralGrowth = (client: SupabaseClient, referralId: string) =>
  invoke<ReferralGrowth | null>(client, "manage-referral", {
    operation: "onboarding.status",
    referralId,
  });
export const growthLabels = {
  awaiting_signup: "Waiting for recipient signup",
  awaiting_review: "Waiting for professional review",
  needs_reconfirmation: "Doctor review required",
  released: "Released to the verified recipient",
  cancelled: "Referral cancelled",
};
export const growthReasons: Record<string, string> = {
  consent_expired:
    "The seven-day release window expired. Review the referral and confirm consent again.",
  requirements_changed:
    "The recipient does not meet the recorded referral requirements. Review them before choosing the next step.",
  recipient_ineligible:
    "The recipient is not currently eligible for new referrals.",
  recipient_unavailable:
    "The intended recipient account could not be independently matched to one eligible practitioner.",
  referrer_inactive:
    "The doctor who confirmed release no longer has active practice access.",
  invitation_unavailable:
    "The invitation expired, was declined or was revoked. It does not grant referral access.",
};
