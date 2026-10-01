import type { SupabaseClient } from "@supabase/supabase-js";
import { invoke, type Application } from "./workflow.ts";
export const startProfileRevision = (
  client: SupabaseClient,
  input: { practitionerId: string; requestId: string },
) =>
  invoke<Application>(client, "practitioner-onboarding", {
    operation: "revision_start",
    ...input,
  });
