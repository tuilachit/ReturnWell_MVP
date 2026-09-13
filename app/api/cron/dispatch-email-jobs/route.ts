export const runtime = "nodejs";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

function workerConfig() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const workerSecret = process.env.EMAIL_WORKER_SECRET?.trim();
  if (!supabaseUrl || !workerSecret) return null;
  try {
    const url = new URL(`${supabaseUrl}/functions/v1/dispatch-email-jobs`);
    if (url.protocol !== "https:") return null;
    return { url: url.toString(), workerSecret };
  } catch {
    return null;
  }
}

function safeResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  if (Number.isInteger(result.processed)) output.processed = result.processed;
  if (Number.isInteger(result.sent)) output.sent = result.sent;
  if (typeof result.configurationNeeded === "boolean") {
    output.configurationNeeded = result.configurationNeeded;
  }
  return output;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return json({ error: "Email worker unavailable" }, 503);
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const config = workerConfig();
  if (!config) return json({ error: "Email worker unavailable" }, 503);

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.workerSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ limit: 20 }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return json({ error: "Email worker unavailable" }, 502);
    return json({ ok: true, result: safeResult(await response.json()) });
  } catch {
    return json({ error: "Email worker unavailable" }, 502);
  }
}
