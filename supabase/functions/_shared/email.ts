import { renderTransactionalEmail } from "./email-layout.ts";
import type { TrustConfig } from "./workflow-security.ts";
export type NotificationKind =
  | "referral_action_required"
  | "referral_created"
  | "referral_accepted"
  | "referral_declined"
  | "referral_cancelled"
  | "referral_closed"
  | "referral_reminder";

export type NotificationJob = {
  id: string;
  referralId: string;
  kind: NotificationKind;
  recipientEmail: string;
  idempotencyKey: string;
  templateData: Record<string, unknown>;
};

const forbiddenFragments = [
  "patient",
  "clinical",
  "diagnosis",
  "condition",
  "postcode",
  "referral_reason",
  "attachment",
];

const hasForbiddenKey = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) => {
    const normalized = key.toLocaleLowerCase("en-AU");
    return (
      forbiddenFragments.some((fragment) => normalized.includes(fragment)) ||
      hasForbiddenKey(nested)
    );
  });
};

const copy: Record<
  NotificationKind,
  { subject: string; heading: string; action: string }
> = {
  referral_action_required: {
    subject: "A referral needs your review — ReturnWell",
    heading: "A referral is waiting for your review",
    action:
      "Sign in to ReturnWell to review onboarding progress and choose the next step. The referral has not been released.",
  },
  referral_cancelled: {
    subject: "A referral has been cancelled — ReturnWell",
    heading: "The referring practice cancelled a referral",
    action:
      "Sign in to ReturnWell to review the update. Do not act on an earlier referral notice.",
  },
  referral_closed: {
    subject: "A referral has been closed — ReturnWell",
    heading: "The referring practice closed a referral",
    action:
      "Sign in to ReturnWell to review the recorded outcome. This is not an appointment confirmation.",
  },
  referral_created: {
    subject: "A referral needs your response",
    heading: "A new referral is ready to review",
    action: "Review the referral securely in ReturnWell.",
  },
  referral_accepted: {
    subject: "A referral status was updated",
    heading: "A referral has been accepted",
    action: "Sign in to ReturnWell to review the update.",
  },
  referral_declined: {
    subject: "A referral needs attention",
    heading: "A referral could not be accepted",
    action: "Sign in to ReturnWell to choose the next step.",
  },
  referral_reminder: {
    subject: "A referral is awaiting your response",
    heading: "A referral still needs a response",
    action: "Sign in to ReturnWell to accept or decline it.",
  },
};

export function buildNotification(
  job: NotificationJob,
  appUrl: string,
  identity: Pick<TrustConfig, "supportEmail" | "websiteUrl" | "businessName">,
) {
  if (hasForbiddenKey(job.templateData)) {
    throw new Error(
      "Notification template data must not contain patient or clinical data.",
    );
  }
  if (!(job.kind in copy)) throw new Error("Unsupported notification kind.");

  const baseUrl = new URL(appUrl);
  if (baseUrl.protocol !== "https:") throw new Error("APP_URL must use HTTPS.");
  const link = new URL(
    `/referrals/${encodeURIComponent(job.referralId)}`,
    baseUrl,
  ).toString();
  const content = copy[job.kind];
  const message = renderTransactionalEmail({
    heading: content.heading,
    bodyParagraphs: [
      content.action,
      "No sensitive health information is included in this email.",
      identity.businessName,
    ],
    action: { label: "Sign in to ReturnWell", url: link },
    supportEmail: identity.supportEmail,
    websiteUrl: identity.websiteUrl,
  });

  return {
    to: job.recipientEmail,
    subject: content.subject,
    ...message,
    idempotencyKey: job.idempotencyKey,
  };
}

export function verificationEmail(
  config: TrustConfig,
  url: string,
  expiresAt: string,
) {
  return {
    subject: "Verify your email for ReturnWell",
    ...renderTransactionalEmail({
      heading: "Verify your email",
      bodyParagraphs: [
        "You requested access to ReturnWell. Open the link, then choose Verify and continue.",
        `This verification expires at ${new Date(expiresAt).toISOString()} (UTC).`,
        "If you did not request this, ignore this email. No workspace access is granted just by opening the link.",
        config.businessName,
      ],
      action: { label: "Review email verification", url },
      supportEmail: config.supportEmail,
      websiteUrl: config.websiteUrl,
    }),
  };
}

type WebhookSignatureInput = {
  payload: string;
  eventId: string;
  timestamp: string;
  signatureHeader: string;
  secret: string;
  nowSeconds?: number;
};

const decodeBase64 = (value: string) => {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
};

export async function verifyWebhookSignature({
  payload,
  eventId,
  timestamp,
  signatureHeader,
  secret,
  nowSeconds = Math.floor(Date.now() / 1000),
}: WebhookSignatureInput): Promise<boolean> {
  const timestampSeconds = Number(timestamp);
  if (
    !Number.isInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > 300
  )
    return false;

  try {
    const encodedSecret = secret.startsWith("whsec_")
      ? secret.slice(6)
      : secret;
    const key = await crypto.subtle.importKey(
      "raw",
      decodeBase64(encodedSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signedPayload = new TextEncoder().encode(
      `${eventId}.${timestamp}.${payload}`,
    );
    const signatures = signatureHeader
      .split(" ")
      .map((part) => part.split(",", 2))
      .filter(([version, value]) => version === "v1" && Boolean(value));
    for (const [, signature] of signatures) {
      if (
        await crypto.subtle.verify(
          "HMAC",
          key,
          decodeBase64(signature),
          signedPayload,
        )
      )
        return true;
    }
    return false;
  } catch {
    return false;
  }
}
