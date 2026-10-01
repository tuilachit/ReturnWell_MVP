import type { SupabaseClient } from "@supabase/supabase-js";
import { invoke } from "./workflow";
import type { EmailDeliverySummary } from "./invitation-progress";
import type { QueueHealth } from "../../supabase/functions/_shared/observability";
export type EmailJobHealth = {
  id: string;
  family: string;
  state: string;
  attempts: number;
  dueAt: string;
  updatedAt: string;
  safeErrorCode: string | null;
  delivery: EmailDeliverySummary;
  recipientMasked: string;
};
export type EmailHealthPage = {
  health: QueueHealth;
  jobs: EmailJobHealth[];
  nextCursor: { createdAt: string; id: string } | null;
};
export function emailOperations(
  client: SupabaseClient,
  cursor: EmailHealthPage["nextCursor"] = null,
) {
  return invoke<EmailHealthPage>(client, "email-operations", {
    operation: "list",
    limit: 25,
    ...(cursor ? { cursor } : {}),
  });
}
