// No request URL, token or clinical value is accepted by this policy builder.
export function securityHeaders({
  supabaseUrl = "",
  development = false,
}: { supabaseUrl?: string; development?: boolean } = {}) {
  let origin = "";
  try {
    const url = new URL(supabaseUrl);
    if (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      (url.protocol === "https:" ||
        (development &&
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname)))
    )
      origin = url.origin;
  } catch {
    /* An invalid origin fails closed to same-origin connections. */
  }
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(24)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
  const script = development
    ? "'self' 'unsafe-inline' 'unsafe-eval'"
    : `'self' 'nonce-${nonce}'`;
  return {
    "content-security-policy": `default-src 'self'; script-src ${script}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'${origin ? " " + origin : ""}${development ? " ws://127.0.0.1:* ws://localhost:*" : ""}; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
}
