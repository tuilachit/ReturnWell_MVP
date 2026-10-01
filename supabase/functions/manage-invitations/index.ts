import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { workflowHandler } from "../_shared/workflow-http.ts";
import { runtime } from "../_shared/runtime.ts";
import manifest from "../_shared/backend-manifest.json" with { type: "json" };
import { withReleaseHealth } from "../_shared/release-health.ts";
const rt = runtime();
Deno.serve(withReleaseHealth("manage-invitations", manifest, rt, workflowHandler("manage-invitations", rt)));
