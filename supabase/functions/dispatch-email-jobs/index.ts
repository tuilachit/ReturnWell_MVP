import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {runtime} from '../_shared/runtime.ts';
import {dispatchHandler} from '../_shared/dispatch-http.ts';
import manifest from "../_shared/backend-manifest.json" with { type: "json" };
import { withReleaseHealth } from "../_shared/release-health.ts";
const rt = runtime();
Deno.serve(withReleaseHealth("dispatch-email-jobs", manifest, rt, dispatchHandler(rt)));
