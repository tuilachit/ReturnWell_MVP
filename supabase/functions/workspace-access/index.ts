import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { workflowHandler } from "../_shared/workflow-http.ts";
import { runtime } from "../_shared/runtime.ts";
Deno.serve(workflowHandler("workspace-access", runtime()));
