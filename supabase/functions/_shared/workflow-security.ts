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
  return encode(crypto.getRandomValues(new Uint8Array(32))).replaceAll("+", "-")
    .replaceAll("/", "_").replaceAll("=", "");
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
export const escapeHtml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
export function invitationEmail(
  invite: {
    kind: string;
    recipient_name: string;
    inviter_name: string;
    practice_name: string;
  },
  token: string,
  config: TrustConfig,
) {
  const url = new URL("/join", config.appUrl);
  url.hash = `invite=${encodeURIComponent(token)}`;
  const purpose = invite.kind === "doctor"
    ? "join their practice on ReturnWell"
    : "create a practitioner profile on ReturnWell";
  const text =
    `Hello ${invite.recipient_name},\n\n${invite.inviter_name} from ${invite.practice_name} has invited you to ${purpose}.\n\nReturnWell helps practices coordinate allied health referrals. ${
      invite.kind === "practitioner"
        ? "After verifying your email, you can confirm your details for a separate identity and registration review. Signing up does not immediately publish your profile."
        : "Verify your work email to join the named practice as a referrer."
    }\n\nReview your invitation:\n${url}\n\nThis invitation expires in seven days. You can decline it on the invitation page; no account is needed to decline. If you were not expecting this, contact us before continuing.\n\nYou can independently visit ${config.websiteUrl}\n${config.businessName}\nSupport: ${config.supportEmail}\nPrivacy: ${config.privacyUrl}\nTerms: ${config.termsUrl}`;
  return {
    subject: `${invite.inviter_name} invited you to ReturnWell`,
    text,
    html:
      `<div style="font-family:Arial,sans-serif;max-width:580px;line-height:1.6"><h1>ReturnWell</h1>${
        text.split("\n\n").map((p) =>
          `<p>${escapeHtml(p).replaceAll("\n", "<br>")}</p>`
        ).join("")
      }<p><a href="${
        escapeHtml(url.toString())
      }">Review invitation</a></p></div>`,
  };
}

export function validateTrustConfig(config: TrustConfig) {
  if (Object.values(config).some((x) => !x?.trim())) {
    throw new Error("sender_configuration");
  }
  const origin = new URL(config.appUrl).origin;
  for (
    const field of ["appUrl", "websiteUrl", "privacyUrl", "termsUrl"] as const
  ) {
    const url = new URL(config[field]);
    if (
      url.protocol !== "https:" || url.username || url.password ||
      url.origin !== origin
    ) throw new Error("sender_configuration");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.supportEmail)) {
    throw new Error("sender_configuration");
  }
  return config;
}
