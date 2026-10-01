import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {runtime} from '../_shared/runtime.ts';
import {dispatchHandler} from '../_shared/dispatch-http.ts';
Deno.serve(dispatchHandler(runtime()));
