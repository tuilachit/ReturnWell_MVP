"use client";
import { useEffect, useMemo, useState } from "react";
import WorkflowShell from "../../workflow-shell";
import { getSupabaseBrowserClient } from "../../lib/supabase";
import {
  confirmationDetails,
  errorText,
  invoke,
  requestId,
} from "../../lib/workflow";
export default function ConfirmPage() {
  const client = useMemo(() => getSupabaseBrowserClient(), []);
  const [credential, setCredential] = useState<URLSearchParams | null>(null);
  const [name, setName] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [verifiedUser, setVerifiedUser] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setCredential(new URLSearchParams(window.location.hash.slice(1)));
        if (!client) setChecking(false);
      }
    });
    if (!client) return;
    void client.auth.getSession().then(({ data }) => {
      if (active) {
        setSignedIn(Boolean(data.session));
        setChecking(false);
      }
    });
    return () => {
      active = false;
    };
  }, [client]);
  async function confirm() {
    if (!client || !credential) return;
    setBusy(true);
    setMessage("");
    try {
      const details = confirmationDetails(credential.toString());
      if (!details)
        throw new Error(
          "This verification link is unavailable. Reopen the complete link from your email.",
        );
      const current = await client.auth.getSession();
      if (current.error)
        throw new Error("Your session could not be checked. Please try again.");
      if (!verified && current.data.session) {
        setSignedIn(true);
        setMessage(
          "An account is already signed in. Sign out before verifying the invited mailbox.",
        );
        return;
      }
      if (verified && current.data.session?.user.id !== verifiedUser) {
        setVerified(false);
        setVerifiedUser(null);
        setSignedIn(Boolean(current.data.session));
        throw new Error(
          "The signed-in account changed. Reopen your invitation to request a new verification email.",
        );
      }
      if (!verified) {
        const { data, error } = await client.auth.verifyOtp({
          token_hash: details.tokenHash,
          type: details.type,
        });
        if (error)
          throw new Error(
            "Verification expired or unavailable. Request a new email from your invitation.",
          );
        setVerified(true);
        setVerifiedUser(data.user?.id || null);
      }
      const result = await invoke<{
        applicationId?: string;
      }>(client, "claim-invitation", {
        invitationId: details.invitationId,
        attemptId: details.attemptId,
        displayName: name.trim(),
        requestId: requestId(),
      });
      window.history.replaceState(null, "", "/auth/confirm");
      window.location.assign(result.applicationId ? "/onboarding" : "/");
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkflowShell title="Verify your email">
      {" "}
      <p>
        Continue only if you requested this email. Opening this page does not
        verify or claim an invitation.
      </p>
      {signedIn && !verified ? (
        <>
          <p>
            An account is already signed in. Sign out explicitly before
            verifying the invited mailbox.
          </p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const result = await client?.auth.signOut();
              if (result?.error)
                setMessage("Sign-out failed. Please try again.");
              else setSignedIn(false);
              setBusy(false);
            }}
          >
            Sign out before verification
          </button>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <label>
            Your display name
            <input
              required
              maxLength={120}
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button
            className="button primary"
            disabled={checking || busy || !client}
          >
            {busy
              ? "Verifying…"
              : verified
                ? "Complete signup"
                : "Verify and continue"}
          </button>
        </form>
      )}
      {message && <p role="alert">{message}</p>}
    </WorkflowShell>
  );
}
