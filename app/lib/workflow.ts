import type { SupabaseClient } from "@supabase/supabase-js";
import type { Workspace } from "../types";
export type Access = {
  doctors: (Workspace & {
    role: string;
  })[];
  practitioners: {
    practitionerId: string;
    displayName: string;
    acceptingNewReferrals: boolean;
  }[];
  applicationId: string | null;
  operator: boolean;
  invitationOrganisations?: {
    organisationId: string;
    organisationName: string;
  }[];
};
export type Application = {
  id: string;
  user_id: string;
  status: "draft" | "submitted" | "changes_requested" | "approved" | "rejected";
  version: number;
  profile: Partial<Profile>;
  applicant_feedback?: string;
  practitioner_id?: string;
  terms_version?: string;
  privacy_version?: string;
  current_terms_version?: string;
  current_privacy_version?: string;
  current_terms_url?: string;
  current_privacy_url?: string;
};
export type Profile = {
  displayName: string;
  profession: "physiotherapist" | "psychologist";
  registrationNumber: string;
  practiceName: string;
  services: string[];
  funding: string[];
  languages: string[];
  telehealth: boolean;
  acceptingNewReferrals: boolean;
  locations: {
    suburb: string;
    postcode: string;
    state: "NSW";
    isPrimary: boolean;
  }[];
};
export type InvitationInfo = {
  invitationId: string;
  inviterName: string;
  practiceName: string;
  recipientName: string;
  maskedEmail: string;
  kind: string;
  expiresAt: string;
  termsVersion: string;
  privacyVersion: string;
  websiteUrl: string;
  privacyUrl: string;
  termsUrl: string;
  supportEmail: string;
  businessName: string;
};
export async function invoke<T>(
  client: SupabaseClient,
  name: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await client.functions.invoke(name, { body });
  if (error) {
    const response = error.context;
    if (response instanceof Response) {
      const payload = await response.json().catch(() => null);
      if (payload?.code === "terms_changed")
        throw new Error(
          "The terms or privacy notice changed. Load the current saved version, review the linked notices, and confirm consent again. Your profile edits are retained.",
        );
      if (response.status === 409)
        throw new Error(
          "This record changed. Your edits are retained. Reload the saved version before trying again.",
        );
      if (payload?.error) throw new Error(payload.error);
    }
    throw new Error("The request could not be completed. Please try again.");
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}
export async function invitationEntry<T>(
  body: Record<string, unknown>,
): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new Error("Secure signup is not configured in this build.");
  const response = await fetch(`${url}/functions/v1/invitation-entry`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify(body),
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  const data = await response.json();
  if (!response.ok || data.error)
    throw new Error(data.error || "This invitation is unavailable.");
  return data as T;
}
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Please try again.";
export const requestId = () => crypto.randomUUID();
export function confirmationDetails(fragment: string) {
  const values = new URLSearchParams(fragment.replace(/^#/, ""));
  const tokenHash = values.get("token_hash") || "";
  const type = values.get("type");
  const invitationId = values.get("invitationId") || "";
  const attemptId = values.get("attemptId") || "";
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    (type !== "invite" && type !== "magiclink") ||
    !tokenHash ||
    tokenHash.length > 4096 ||
    !uuid.test(invitationId) ||
    !uuid.test(attemptId)
  )
    return null;
  return { tokenHash, type, invitationId, attemptId };
}
export type NotificationRecord = {
  kind: string;
  status: string;
  createdAt?: string;
  errorCode?: string;
  delivered?: boolean;
};
export type ReferralNotifications = {
  status?: string;
  notifications: NotificationRecord[];
};
export function notificationLabel(record: NotificationRecord) {
  if (record.status === "suppressed") return "Email suppressed";
  if (["exhausted", "failed"].includes(record.status))
    return "Email failed — needs attention";
  if (
    [
      "paused_configuration",
      "blocked_configuration",
      "configuration_needed",
    ].includes(record.status)
  )
    return "Email needs delivery configuration";
  if (record.status === "needs_review") return "Email delivery needs review";
  if (record.status === "cancelled") return "Email cancelled";
  if (record.delivered) return "Email delivered — this does not mean read";
  if (record.status === "sent")
    return "Email sent — delivery not yet confirmed";
  if (["pending", "processing", "queued"].includes(record.status))
    return "Email pending";
  return "Email status unavailable";
}
export function safeDestination(path: string) {
  return /^\/referrals\/[0-9a-f-]{36}$/i.test(path) ||
    [
      "/",
      "/invitations",
      "/onboarding",
      "/admin/practitioners",
      "/practitioner",
    ].includes(path)
    ? path
    : "/";
}
