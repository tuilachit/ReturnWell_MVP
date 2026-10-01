import type { SupabaseClient } from "@supabase/supabase-js";
import { invoke } from "./workflow.ts";
export type ReferralHandover = {
  status: string;
  practiceName: string;
  contactPhone: string | null;
  secureInstructions: string | null;
  reviewedAt: string | null;
  nextAction: string;
};
export const getReferralHandover = (
  client: SupabaseClient,
  referralId: string,
) =>
  invoke<ReferralHandover>(client, "manage-referral", {
    operation: "handover.read",
    referralId,
  });
export function handoverHeading(status: string) {
  return (
    (
      {
        accepted: "Arrange external handover",
        sent: "Awaiting a response",
        awaiting_onboarding: "Awaiting practitioner onboarding",
        declined: "Review the next referral option",
        cancelled: "Referral cancelled",
        closed: "Coordination closed",
        booked: "Historical booking record",
      } as Record<string, string>
    )[status] || "Handover status unavailable"
  );
}
export function handoverPhoneHref(phone: string | null) {
  if (
    !phone ||
    !/^\+?[0-9 ()-]{5,60}$/.test(phone) ||
    (phone.match(/[0-9]/g)?.length ?? 0) < 5
  )
    return null;
  return "tel:" + phone.replace(/[ ()-]/g, "");
}
export function handoverInstructionParts(
  text: string,
): { text: string; href?: string }[] {
  return text
    .split(/(https:\/\/[^\s<>"']+)/g)
    .filter(Boolean)
    .map((part) => {
      if (!part.startsWith("https://")) return { text: part };
      try {
        const url = new URL(part);
        // No inline HTML, email/body links, credentials or query-token links.
        if (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        )
          return { text: part, href: url.href };
      } catch {
        /* Keep malformed/unapproved link forms as ordinary escaped text. */
      }
      return { text: part };
    });
}
