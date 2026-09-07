import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { runtime } from "../_shared/runtime.ts";
import { workflowHandler } from "../_shared/workflow-http.ts";
// Compatibility endpoint: participants inspect the queue. Only the internal
// worker can send; a browser request cannot trigger email delivery.
Deno.serve(workflowHandler("send-referral-notification", runtime()));
