import { verifyWebhookSignature } from "./email.ts";
import type { WorkflowRuntime } from "./workflow-http.ts";
const eventMap: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.suppressed": "suppressed",
  "email.failed": "failed",
};
export function webhookHandler(deps: Pick<WorkflowRuntime, "env" | "rpc">) {
  return async (request: Request) => {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        },
      });
    if (request.method !== "POST")
      return json({ error: "Method not allowed" }, 405);
    if (!deps.env.RESEND_WEBHOOK_SECRET)
      return json({ error: "Webhook unavailable" }, 503);
    try {
      const reader = request.body?.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      if (reader)
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
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const payload = new TextDecoder().decode(bytes),
        eventId = request.headers.get("svix-id") ?? "";
      if (
        !(await verifyWebhookSignature({
          payload,
          eventId,
          timestamp: request.headers.get("svix-timestamp") ?? "",
          signatureHeader: request.headers.get("svix-signature") ?? "",
          secret: deps.env.RESEND_WEBHOOK_SECRET,
        }))
      )
        return json({ error: "Invalid signature" }, 401);
      const event = JSON.parse(payload),
        eventType = Object.hasOwn(eventMap, event.type)
          ? eventMap[event.type]
          : null;
      if (!eventType) return json({ ok: true, ignored: true });
      if (
        typeof event.data?.email_id !== "string" ||
        !event.data.email_id ||
        event.data.email_id.length > 256 ||
        !eventId ||
        eventId.length > 256
      )
        return json({ error: "Invalid event" }, 400);
      const occurredAt = event.created_at ?? new Date().toISOString();
      if (
        typeof occurredAt !== "string" ||
        !Number.isFinite(Date.parse(occurredAt))
      )
        return json({ error: "Invalid event" }, 400);
      // Persist the allowlisted metadata before acknowledging. Never forward or
      // log the raw body, subject, recipient list, HTML or provider diagnostics.
      await deps.rpc(null, "email.webhook", {
        eventId,
        providerId: event.data.email_id,
        eventType,
        occurredAt,
      });
      return json({ ok: true });
    } catch {
      return json({ error: "Event could not be recorded" }, 503);
    }
  };
}
