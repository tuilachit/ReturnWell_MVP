export const escapeEmailHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
// Readable deadline for Australian recipients, e.g. "Fri 17 Oct 2026, 10:33 pm (Sydney time)".
export function sydneyTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw Error("invalid_deadline");
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toLowerCase()} (Sydney time)`;
}
export function renderTransactionalEmail(input: {
  heading: string;
  preheader?: string;
  bodyParagraphs: string[];
  // A one-time code shown prominently after the body, digits only.
  code?: string;
  supportingParagraphs?: string[];
  action: { label: string; url: string } | null;
  supportEmail: string;
  websiteUrl: string;
}): { html: string; text: string } {
  const website = new URL(input.websiteUrl);
  if (
    website.protocol !== "https:" ||
    website.username ||
    website.password ||
    website.hash ||
    website.search
  )
    throw Error("sender_configuration");
  if (
    !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(
      input.supportEmail,
    )
  )
    throw Error("sender_configuration");
  if (input.action) {
    const action = new URL(input.action.url);
    if (
      action.protocol !== "https:" ||
      action.username ||
      action.password ||
      action.origin !== website.origin
    )
      throw Error("sender_configuration");
  }
  if (input.code !== undefined && !/^[0-9]{6,10}$/.test(input.code))
    throw Error("invalid_code");
  const esc = escapeEmailHtml;
  const action = input.action;
  const text = [
    "ReturnWell",
    input.heading,
    ...input.bodyParagraphs,
    ...(input.code ? [`Your code: ${input.code}`] : []),
    ...(action ? [`${action.label}:\n${action.url}`] : []),
    ...(input.supportingParagraphs ?? []),
    `Visit ReturnWell independently: ${website.href}`,
    `Support: ${input.supportEmail}`,
  ].join("\n\n");
  // Same visual language as the app: soft grey canvas, white rounded card,
  // charcoal text and a ReturnWell-red pill action. Table layout and inline
  // styles keep it consistent across email clients.
  const html = `<!doctype html>
<html lang="en" dir="ltr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(input.heading)} — ReturnWell</title></head>
<body style="margin:0;padding:0;background:#eef0f3;color:#1b1d20;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:16px;line-height:1.6">
${input.preheader ? `<div lang="en" dir="ltr" aria-hidden="true" style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all">${esc(input.preheader)}</div>` : ""}
<table lang="en" dir="ltr" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef0f3"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px">
<tr><td style="padding:0 8px 16px"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="width:32px;height:32px;background:#c4302a;border-radius:10px;color:#ffffff;font-weight:700;font-size:18px;text-align:center;line-height:32px">R</td><td style="padding-left:10px;color:#1b1d20;font-weight:600;font-size:19px;letter-spacing:-0.3px">ReturnWell</td></tr></table></td></tr>
<tr><td style="background:#ffffff;border:1px solid #e3e7eb;border-radius:24px;padding:32px 28px;overflow-wrap:anywhere;word-break:break-word">
<h1 style="margin:0 0 20px;font-size:25px;line-height:1.3;font-weight:600;letter-spacing:-0.3px;color:#1b1d20">${esc(input.heading)}</h1>
${input.bodyParagraphs.map((p) => `<p style="margin:0 0 16px;color:#33373c">${esc(p).replaceAll("\n", "<br>")}</p>`).join("")}
${input.code ? `<p style="margin:10px 0 24px;padding:16px 20px;background:#f4f6f8;border-radius:16px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:34px;line-height:1.2;font-weight:700;letter-spacing:8px;color:#1b1d20;text-align:center" aria-label="Your code">${esc(input.code)}</p>` : ""}
${action ? `<p style="margin:26px 0 8px"><a href="${esc(action.url)}" style="display:inline-block;background:#c4302a;color:#ffffff;border-radius:999px;padding:14px 26px;line-height:22px;text-decoration:none;font-weight:600">${esc(action.label)}</a></p>` : ""}
<hr style="border:0;border-top:1px solid #e9ecef;margin:26px 0">
${(input.supportingParagraphs ?? []).map((p) => `<p style="margin:0 0 14px;font-size:14px;color:#60676e">${esc(p).replaceAll("\n", "<br>")}</p>`).join("")}
<p style="margin:0 0 10px;font-size:14px;color:#60676e">Visit ReturnWell independently:<br><a href="${esc(website.href)}" style="color:#a12520">ReturnWell website — ${esc(website.host)}</a></p>
<p style="margin:0;font-size:14px;color:#60676e">Need help? <a href="mailto:${esc(input.supportEmail)}" style="color:#a12520">Contact support — ${esc(input.supportEmail)}</a></p>
</td></tr></table></td></tr></table>
</body></html>`;
  return { html, text };
}
