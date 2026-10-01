import { getProfession } from "./professions.ts";
export type CredentialSummary = {
  professionId: string;
  authorityId: string;
  route: "ahpra" | "professional_body";
  status: "not_checked" | "verified" | "failed" | "expired";
  checkedAt: string | null;
  expiresAt: string | null;
  reviewDueAt: string | null;
  policyEnabled: boolean;
};
type Profile = {
  lifecycleStatus: string;
  providerConfirmationStatus: string;
  acceptingNewReferrals: boolean;
  accessSuspended?: boolean;
  credentials?: CredentialSummary[];
};
export function isEligibleForNewReferral(
  profile: Profile,
  professionId: string,
  now = new Date(),
): boolean {
  const profession = getProfession(professionId);
  if (
    !profession ||
    profession.scope !== "supported" ||
    profile.lifecycleStatus !== "active" ||
    profile.providerConfirmationStatus !== "confirmed" ||
    !profile.acceptingNewReferrals ||
    profile.accessSuspended
  )
    return false;
  const time = now.getTime();
  return (
    profile.credentials?.some(
      (c) =>
        c.professionId === professionId &&
        c.authorityId === profession.authorityId &&
        c.route === profession.route &&
        c.policyEnabled &&
        c.status === "verified" &&
        c.checkedAt !== null &&
        Number.isFinite(Date.parse(c.checkedAt)) &&
        Date.parse(c.checkedAt) <= time &&
        c.reviewDueAt !== null &&
        Date.parse(c.reviewDueAt) > time &&
        (c.expiresAt === null || Date.parse(c.expiresAt) > time),
    ) ?? false
  );
}
