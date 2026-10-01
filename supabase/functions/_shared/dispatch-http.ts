import {
  boundedBody,
  type WorkflowRuntime,
  type Row,
} from "./workflow-http.ts";
import { dispatchJobs } from "./dispatch.ts";
import { sendProviderEmail } from "./provider-transport.ts";
import { recordOperationalEvent } from "./observability.ts";
export function dispatchHandler(
  deps: Pick<WorkflowRuntime, "env" | "rpc">,
  send: (payload: Row, key: string) => Promise<Response> = (payload, key) =>
    sendProviderEmail(deps.env, payload, key),
) {
  return async (request: Request) => {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
        },
      });
    if (request.method !== "POST")
      return json({ error: "Method not allowed" }, 405);
    if (
      !deps.env.EMAIL_WORKER_SECRET ||
      request.headers.get("authorization") !==
        `Bearer ${deps.env.EMAIL_WORKER_SECRET}`
    )
      return json({ error: "Unauthorized" }, 401);
    const started = Date.now(),
      requestId = crypto.randomUUID();
    try {
      const body = await boundedBody(request),
        limit = Number(body.limit ?? 10);
      if (!Number.isInteger(limit) || limit < 1 || limit > 20)
        return json({ error: "Invalid limit" }, 400);
      await deps.rpc(null, "operations.record", { event: "dispatch_started" });
      const result = await dispatchJobs(deps, limit, send);
      await deps.rpc(null, "operations.record", {
        event: "dispatch_completed",
      });
      recordOperationalEvent({
        event: "dispatch_completed",
        routeTemplate: "dispatch-email-jobs",
        status: 200,
        durationMs: Date.now() - started,
        requestId,
      });
      return json(result);
    } catch {
      try {
        await deps.rpc(null, "operations.record", { event: "dispatch_failed" });
      } catch {
        /* Privacy-safe host signal remains available when storage is down. */
      }
      recordOperationalEvent({
        event: "dispatch_failed",
        routeTemplate: "dispatch-email-jobs",
        status: 503,
        durationMs: Date.now() - started,
        requestId,
      });
      return json({ error: "Dispatch unavailable" }, 503);
    }
  };
}
