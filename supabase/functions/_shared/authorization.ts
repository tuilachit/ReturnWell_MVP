export type VerifiedIdentity = { id: string; aal?: "aal1" | "aal2" };
type IdentityProvider = {
  getUser(
    token: string,
  ): Promise<{
    data: { user: { id: string; factors?: { status: string }[] } | null };
    error: unknown;
  }>;
  getClaims(
    token: string,
  ): Promise<{
    data: { claims: { sub?: string; aal?: unknown } } | null;
    error: unknown;
  }>;
};

// Both methods verify with Supabase. Never decode an unverified JWT, read
// user_metadata, or reuse the browser's reported assurance as authority.
export async function verifiedIdentity(
  auth: IdentityProvider,
  token: string,
): Promise<VerifiedIdentity | null> {
  const user = await auth.getUser(token);
  if (user.error || !user.data.user) return null;
  const claims = await auth.getClaims(token);
  if (claims.error || claims.data?.claims.sub !== user.data.user.id)
    return null;
  const factorStillPresent = user.data.user.factors?.some(
    (factor) => factor.status === "verified",
  );
  return {
    id: user.data.user.id,
    aal:
      claims.data.claims.aal === "aal2" && factorStillPresent ? "aal2" : "aal1",
  };
}
export async function requireOperatorStepUp(
  identity: VerifiedIdentity,
): Promise<void> {
  if (identity.aal !== "aal2") throw Error("step_up_required");
  // Current operator status and independent-review authority are rechecked in
  // the transaction; AAL2 alone does not confer a role or access to any record.
}
export function requiresStepUp(action: string) {
  return [
    "review.decide",
    "review.suspend",
    "review.restore",
    "practice.create",
    "practice.reviewContact",
    "practice.reviewInviter",
    "practice.revokeMember",
  ].includes(action);
}
