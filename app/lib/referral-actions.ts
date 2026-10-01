import type { SupabaseClient } from "@supabase/supabase-js";
import { invoke } from "./workflow.ts";
import { rowToReferral, type ReferralRow } from "./referrals.ts";
import type { ReferralDraft } from "./referral-drafts.ts";
export const cancellationReasons = {
  entered_in_error: "Entered in error",
  no_longer_required: "No longer required",
  other: "Other",
};
export const closureReasons = {
  handover_completed: "External handover completed",
  no_longer_required: "No longer required",
  unable_to_arrange: "Unable to arrange handover",
};
export function allowedReferralActions(
  status: string,
): ("cancel" | "close" | "replace")[] {
  if (status === "sent" || status === "awaiting_onboarding") return ["cancel"];
  if (status === "accepted") return ["cancel", "close"];
  if (status === "declined" || status === "cancelled") return ["replace"];
  return [];
}
export async function transitionReferral(
  client: SupabaseClient,
  input: {
    referralId: string;
    expectedVersion: number;
    requestId: string;
    action: "cancel" | "close";
    reasonCode: string;
    note?: string;
    handoverConfirmed?: boolean;
  },
) {
  const reasons =
    input.action === "cancel" ? cancellationReasons : closureReasons;
  if (
    !Object.hasOwn(reasons, input.reasonCode) ||
    (input.note?.length ?? 0) > 500
  )
    throw Error(
      "Choose a valid reason and keep the note within 500 characters.",
    );
  if (input.reasonCode === "handover_completed" && !input.handoverConfirmed)
    throw Error("Confirm that the external handover has been completed.");
  const result = await invoke<{ referral: ReferralRow; notification: string }>(
    client,
    "manage-referral",
    { operation: "transition", ...input },
  );
  return { ...result, referral: rowToReferral(result.referral) };
}
export const startReplacementDraft = (
  client: SupabaseClient,
  input: { referralId: string; expectedVersion: number; requestId: string },
) =>
  invoke<ReferralDraft>(client, "manage-referral", {
    operation: "replace",
    ...input,
  });
