export const escapeEmailHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export function renderTransactionalEmail(input: {
  heading: string;
  preheader?: string;
  bodyParagraphs: string[];
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
  const esc = escapeEmailHtml;
  const action = input.action;
  const text = [
    "ReturnWell",
    input.heading,
    ...input.bodyParagraphs,
    ...(action ? [`${action.label}:\n${action.url}`] : []),
    ...(input.supportingParagraphs ?? []),
    `Visit ReturnWell independently: ${website.href}`,
    `Support: ${input.supportEmail}`,
  ].join("\n\n");
  const html = `<!doctype html>
<html lang="en" dir="ltr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(input.heading)} — ReturnWell</title></head>
<body style="margin:0;padding:0;background:#f5f5f4;color:#202020;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:16px;line-height:1.6">
${input.preheader ? `<div lang="en" dir="ltr" aria-hidden="true" style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all">${esc(input.preheader)}</div>` : ""}
<table lang="en" dir="ltr" role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e5e5e5;border-radius:12px">
<tr><td style="padding:22px 24px;border-bottom:1px solid #eeeeee;color:#ae2424;font-weight:600;font-size:19px">ReturnWell</td></tr>
<tr><td style="padding:24px;overflow-wrap:anywhere;word-break:break-word">
<h1 style="margin:0 0 24px;font-size:25px;line-height:1.3;font-weight:600">${esc(input.heading)}</h1>
${input.bodyParagraphs.map((p) => `<p style="margin:0 0 18px">${esc(p).replaceAll("\n", "<br>")}</p>`).join("")}
${action ? `<p style="margin:26px 0"><a href="${esc(action.url)}" style="display:inline-block;background:#ae2424;color:#ffffff;border-radius:8px;padding:13px 20px;line-height:24px;text-decoration:none;font-weight:600">${esc(action.label)}</a></p>` : ""}
<hr style="border:0;border-top:1px solid #e5e5e5;margin:26px 0">
${(input.supportingParagraphs ?? []).map((p) => `<p style="margin:0 0 16px;font-size:14px;color:#555555">${esc(p).replaceAll("\n", "<br>")}</p>`).join("")}
<p style="margin:0 0 12px;font-size:14px;color:#555555">Visit ReturnWell independently:<br><a href="${esc(website.href)}" style="color:#8c2020">ReturnWell website — ${esc(website.host)}</a></p>
<p style="margin:0;font-size:14px;color:#555555">Need help? <a href="mailto:${esc(input.supportEmail)}" style="color:#8c2020">Contact support — ${esc(input.supportEmail)}</a></p>
</td></tr></table></td></tr></table>
</body></html>`;
  return { html, text };
}
