import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { runtime } from "../_shared/runtime.ts";
import { webhookHandler } from "../_shared/webhook-http.ts";
Deno.serve(webhookHandler(runtime()));
