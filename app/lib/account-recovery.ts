export type RecoveryAction = {
  next:
    "sign_in" | "request_verification" | "complete_claim" | "contact_inviter";
  message: string;
};
// Guidance only. sameAccount/attempt validity must come from the authenticated
// recovery projection; client possession of a forwarded link is never proof.
export function accountRecovery(state: {
  signedIn: boolean;
  invitation: "valid" | "expired";
  attempt: "valid" | "expired";
  sameAccount: boolean;
}): RecoveryAction {
  if (state.invitation === "expired")
    return {
      next: "contact_inviter",
      message:
        "Ask your inviter for a new invitation. This link cannot be extended here.",
    };
  if (state.signedIn && !state.sameAccount)
    return {
      next: "sign_in",
      message:
        "This account cannot complete this invitation. Sign out and verify the invited mailbox.",
    };
  if (state.signedIn && state.sameAccount && state.attempt === "valid")
    return {
      next: "complete_claim",
      message:
        "Your mailbox is confirmed. Finish joining with the same account; no new verification is needed.",
    };
  return {
    next: "request_verification",
    message:
      "Reopen your original invitation email and request a fresh verification email.",
  };
}
export type ClaimRecovery = {
  invitationId: string;
  attemptId: string;
  practiceName: string;
  expiresAt: string;
};
