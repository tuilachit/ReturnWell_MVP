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
  },
  token: string,
  config: TrustConfig,
) {
  validateTrustConfig(config);
  const url = new URL("/join", config.appUrl);
  url.hash = `invite=${encodeURIComponent(token)}`;
  const purpose =
    invite.kind === "doctor"
      ? "join their practice on ReturnWell"
      : "create a practitioner profile on ReturnWell";
  const expiry = invite.expires_at
    ? `This invitation expires at ${new Date(invite.expires_at).toISOString()} (UTC). Replacing the link does not extend this deadline.`
    : "The exact expiry will appear in the issued invitation.";
  const paragraphs = [
    `Hello ${invite.recipient_name},`,
    `${invite.inviter_name} from ${invite.practice_name} has invited you to ${purpose}.`,
    `ReturnWell helps practices coordinate allied health referrals. ${
      invite.kind === "practitioner"
        ? "After verifying your email, you can confirm your details for a separate identity and registration review. Signing up does not immediately publish your profile."
        : "Verify your work email to join the named practice as a referrer."
    }`,
    expiry,
    "You can decline on the invitation page; no account is needed to decline. If you were not expecting this, contact us before continuing.",
    config.businessName,
    `Privacy: ${config.privacyUrl}\nTerms: ${config.termsUrl}`,
  ];
  return {
    subject: `${invite.inviter_name} invited you to ReturnWell`.replaceAll(
      /[\r\n]/g,
      " ",
    ),
    ...renderTransactionalEmail({
      heading: "You’re invited to ReturnWell",
      bodyParagraphs: paragraphs,
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
