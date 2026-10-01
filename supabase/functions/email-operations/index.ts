import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { runtime } from "../_shared/runtime.ts";
import { workflowHandler } from "../_shared/workflow-http.ts";
Deno.serve(workflowHandler("email-operations", runtime()));
