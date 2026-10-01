import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { runtime } from "../_shared/runtime.ts";
import { workflowHandler } from "../_shared/workflow-http.ts";
// Compatibility endpoint: participants inspect the queue. Only the internal
// worker can send; a browser request cannot trigger email delivery.
import manifest from "../_shared/backend-manifest.json" with { type: "json" };
import { withReleaseHealth } from "../_shared/release-health.ts";
const rt = runtime();
Deno.serve(withReleaseHealth("send-referral-notification", manifest, rt, workflowHandler("send-referral-notification", rt)));
