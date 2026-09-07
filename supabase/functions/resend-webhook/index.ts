import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { runtime } from "../_shared/runtime.ts";
import { verifyWebhookSignature } from "../_shared/email.ts";
const deps = runtime();
const eventMap: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.suppressed": "suppressed",
  "email.failed": "failed",
};
Deno.serve(async (request: Request) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!deps.env.RESEND_WEBHOOK_SECRET) {
    return json({ error: "Webhook unavailable" }, 503);
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        return json({ error: "Payload too large" }, 413);
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const payload = new TextDecoder().decode(bytes);
  const eventId = request.headers.get("svix-id") ?? "";
  if (
    !await verifyWebhookSignature({
      payload,
      eventId,
      timestamp: request.headers.get("svix-timestamp") ?? "",
      signatureHeader: request.headers.get("svix-signature") ?? "",
      secret: deps.env.RESEND_WEBHOOK_SECRET,
    })
  ) return json({ error: "Invalid signature" }, 401);
  try {
    const event = JSON.parse(payload);
    const eventType = eventMap[event.type];
    if (!eventType) return json({ ok: true, ignored: true });
    if (typeof event.data?.email_id !== "string" || !eventId) {
      return json({ error: "Invalid event" }, 400);
    }
    await deps.rpc(null, "email.webhook", {
      eventId,
      providerId: event.data.email_id,
      eventType,
      occurredAt: event.created_at ?? new Date().toISOString(),
    });
    return json({ ok: true });
  } catch {
    return json({ error: "Event could not be recorded" }, 503);
  }
});
