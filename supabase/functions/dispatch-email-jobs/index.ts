import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { runtime } from "../_shared/runtime.ts";
import { boundedBody } from "../_shared/workflow-http.ts";
import { dispatchJobs } from "../_shared/dispatch.ts";
const deps = runtime();
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
  if (
    !deps.env.EMAIL_WORKER_SECRET ||
    request.headers.get("authorization") !==
      `Bearer ${deps.env.EMAIL_WORKER_SECRET}`
  ) return json({ error: "Unauthorized" }, 401);
  try {
    const body = await boundedBody(request);
    const limit = Number(body.limit ?? 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      return json({ error: "Invalid limit" }, 400);
    }
    return json(
      await dispatchJobs(
        deps,
        limit,
        (payload, idempotencyKey) =>
          fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              authorization: `Bearer ${deps.env.RESEND_API_KEY}`,
              "content-type": "application/json",
              "idempotency-key": idempotencyKey,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10000),
          }),
      ),
    );
  } catch {
    return json({ error: "Dispatch unavailable" }, 503);
  }
});
