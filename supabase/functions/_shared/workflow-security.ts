import { renderTransactionalEmail, escapeEmailHtml, sydneyTime } from "./email-layout.ts";
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
  if (invite.directory_referral) return directoryReferralEmail(invite, url, config);
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

// One doctor-selected referral to a public directory contact. Written to be
// recognisable and specific: who sent it, who it is for, where the button
// goes and what happens next. No patient details.
function directoryReferralEmail(
  invite: {
    recipient_name: string;
    inviter_name: string;
    practice_name: string;
    expires_at?: string;
    referral_practice_name?: string;
  },
  url: URL,
  config: TrustConfig,
) {
  const clinic = invite.referral_practice_name || "your practice";
  return {
    subject: `Referral for ${invite.recipient_name} from ${invite.practice_name}`.replaceAll(/[\r\n]/g, " "),
    ...renderTransactionalEmail({
      heading: `A patient referral from ${invite.practice_name}`,
      preheader: `${invite.inviter_name} sent this referral through ReturnWell. Patient details stay on the secure page.`,
      bodyParagraphs: [
        `Hello ${invite.recipient_name},`,
        `${invite.inviter_name} at ${invite.practice_name} has referred a patient to you at ${clinic}. They found your practice’s public listing and sent this one referral through ReturnWell, the referral service they use. This is not marketing.`,
        "To view it, open the referral. We’ll email a 6-digit code to this same address; type it on the page to see the patient details and accept or decline. There’s no password and no account to set up.",
        `The button opens ReturnWell’s referral page at ${url.host}.`,
      ],
      supportingParagraphs: [
        "ReturnWell never asks for passwords, bank, card or Medicare details by email.",
        `If this is a shared clinic inbox, please pass it to ${invite.recipient_name}. Not the right person, or not expecting this? You can decline on the referral page without signing in, or check with ${invite.practice_name} using contact details you already trust.`,
        ...(invite.expires_at ? [`This referral link works until ${sydneyTime(invite.expires_at)}.`] : []),
        `Sent by ReturnWell on behalf of ${invite.practice_name}.\n${config.businessName}`,
        `Privacy: ${config.privacyUrl}\nTerms: ${config.termsUrl}`,
      ],
      action: { label: "Open the referral", url: url.toString() },
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
