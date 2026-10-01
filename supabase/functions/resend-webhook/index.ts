import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { runtime } from "../_shared/runtime.ts";
import { webhookHandler } from "../_shared/webhook-http.ts";
import manifest from "../_shared/backend-manifest.json" with { type: "json" };
import { withReleaseHealth } from "../_shared/release-health.ts";
const rt = runtime();
Deno.serve(withReleaseHealth("resend-webhook", manifest, rt, webhookHandler(rt)));
