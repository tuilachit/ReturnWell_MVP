import { renderTransactionalEmail, escapeEmailHtml } from "./email-layout.ts";
export type TrustConfig = {
  appUrl: string;
  websiteUrl: string;
  businessName: string;
  supportEmail: string;
  privacyUrl: string;
  termsUrl: string;
  termsVersion: string;
  privacyVersion: string;
};
export type Envelope = { keyId: string; iv: string; ciphertext: string };
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) =>
  Uint8Array.from(atob(value), (x) => x.charCodeAt(0));
export function newInvitationToken() {
  return encode(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
export async function hashToken(token: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
export async function seal(
  value: unknown,
  secret: string,
  keyId: string,
  context: string,
): Promise<Envelope> {
  const bytes = decode(secret);
  if (bytes.length !== 32) throw new Error("encryption_configuration");
  const key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return { keyId, iv: encode(iv), ciphertext: encode(new Uint8Array(data)) };
}
export async function unseal(
  envelope: Envelope,
  secret: string,
  context: string,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    decode(secret),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const data = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decode(envelope.iv),
      additionalData: new TextEncoder().encode(context),
    },
    key,
    decode(envelope.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(data));
}
export const escapeHtml = escapeEmailHtml;
export function invitationEmail(
  invite: {
    kind: string;
    recipient_name: string;
    inviter_name: string;
    practice_name: string;
    expires_at?: string;
    directory_referral?: boolean;
    referral_practice_name?: string;
  },
  token: string,
  config: TrustConfig,
) {
  validateTrustConfig(config);
  const url = new URL("/join", config.appUrl);
  url.hash = `invite=${encodeURIComponent(token)}`;
  const purpose =
    invite.kind === "doctor"
      ? "join their practice on ReturnWell as a referrer"
      : "connect with their practice through ReturnWell";
  const expiry = invite.expires_at
    ? `This invitation expires at ${new Date(invite.expires_at).toISOString()} (UTC). Replacing the link does not extend this deadline.`
    : "The exact expiry will appear in the issued invitation.";
  const paragraphs = [
    `Hello ${invite.recipient_name},`,
    invite.directory_referral
      ? `${invite.inviter_name} at ${invite.practice_name} has prepared a referral for ${invite.recipient_name} at ${invite.referral_practice_name}. ReturnWell securely coordinates the referral; patient details are not included in this email.`
      : `${invite.inviter_name} at ${invite.practice_name} has invited you to ${purpose}. ReturnWell helps practices coordinate allied health referrals.`,
    "You can review the invitation before deciding whether to join. If you proceed, you’ll be asked to sign in or create an account and confirm your professional details.",
  ];
  const supportingParagraphs = [
    ...(invite.directory_referral ? ["This may be a shared clinic inbox. Only the independently verified intended practitioner can receive patient details after signup and review."] : []),
    `Not expecting this? You can confirm the request with ${invite.practice_name} using contact details you already trust or find independently.`,
    ...(invite.kind === "practitioner"
      ? ["After verifying your email, your professional details go through a separate identity and registration review. Signing up does not immediately publish your profile."]
      : []),
    "You can decline on the invitation page; no account is needed to decline.",
    expiry,
    `Sent by ReturnWell on behalf of ${invite.practice_name}.\n${config.businessName}`,
    `Privacy: ${config.privacyUrl}\nTerms: ${config.termsUrl}`,
  ];
  return {
    subject: (invite.directory_referral ? `Referral from ${invite.practice_name} — review securely on ReturnWell` : `${invite.practice_name} has invited you to ${invite.kind === "doctor" ? "join their practice" : "connect"} on ReturnWell`).replaceAll(
      /[\r\n]/g,
      " ",
    ),
    ...renderTransactionalEmail({
      heading: invite.directory_referral ? "A referral for your practice" : `${invite.kind === "doctor" ? "Join" : "Connect with"} ${invite.practice_name}`,
      preheader: invite.directory_referral ? "Review the sender and intended practitioner before securely signing in." : "Review your practice invitation before deciding whether to join ReturnWell.",
      bodyParagraphs: paragraphs,
      supportingParagraphs,
      action: { label: "Review invitation", url: url.toString() },
      supportEmail: config.supportEmail,
      websiteUrl: config.websiteUrl,
    }),
  };
}

export function validateTrustConfig(config: TrustConfig) {
  if (Object.values(config).some((x) => !x?.trim())) {
    throw new Error("sender_configuration");
  }
  const origin = new URL(config.appUrl).origin;
  for (const field of [
    "appUrl",
    "websiteUrl",
    "privacyUrl",
    "termsUrl",
  ] as const) {
    const url = new URL(config[field]);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.origin !== origin
    )
      throw new Error("sender_configuration");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.supportEmail)) {
    throw new Error("sender_configuration");
  }
  return config;
}
