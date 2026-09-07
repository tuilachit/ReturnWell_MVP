export type NotificationKind =
  | "referral_created"
  | "referral_accepted"
  | "referral_declined"
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
    return forbiddenFragments.some((fragment) => normalized.includes(fragment)) || hasForbiddenKey(nested);
  });
};

const copy: Record<NotificationKind, { subject: string; heading: string; action: string }> = {
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

export function buildNotification(job: NotificationJob, appUrl: string) {
  if (hasForbiddenKey(job.templateData)) {
    throw new Error("Notification template data must not contain patient or clinical data.");
  }
  if (!(job.kind in copy)) throw new Error("Unsupported notification kind.");

  const baseUrl = new URL(appUrl);
  if (baseUrl.protocol !== "https:") throw new Error("APP_URL must use HTTPS.");
  const link = new URL(`/referrals/${encodeURIComponent(job.referralId)}`, baseUrl).toString();
  const content = copy[job.kind];
  const text = `${content.heading}\n\n${content.action}\n\nSign in to ReturnWell:\n${link}\n\nNo sensitive health information is included in this email.`;
  const html = `<h1>${content.heading}</h1><p>${content.action}</p><p><a href="${link}">Sign in to ReturnWell</a></p><p>No sensitive health information is included in this email.</p>`;

  return {
    to: job.recipientEmail,
    subject: content.subject,
    text,
    html,
    idempotencyKey: job.idempotencyKey,
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
  if (!Number.isInteger(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > 300) return false;

  try {
    const encodedSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
    const key = await crypto.subtle.importKey(
      "raw",
      decodeBase64(encodedSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signedPayload = new TextEncoder().encode(`${eventId}.${timestamp}.${payload}`);
    const signatures = signatureHeader.split(" ").map((part) => part.split(",", 2)).filter(([version, value]) => version === "v1" && Boolean(value));
    for (const [, signature] of signatures) {
      if (await crypto.subtle.verify("HMAC", key, decodeBase64(signature), signedPayload)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
