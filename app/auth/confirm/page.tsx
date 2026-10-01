"use client";
/* Full navigation clears account/credential state. */
/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useMemo, useRef, useState } from "react";
import WorkflowShell from "../../workflow-shell";
import { getSupabaseBrowserClient } from "../../lib/supabase";
import {
  accountRecovery,
  type ClaimRecovery,
} from "../../lib/account-recovery";
import {
  confirmationDetails,
  errorText,
  invoke,
  requestId,
} from "../../lib/workflow";

export default function ConfirmPage() {
  const client = useMemo(() => getSupabaseBrowserClient(), []);
  const [credential, setCredential] =
    useState<ReturnType<typeof confirmationDetails>>(null);
  const [attempts, setAttempts] = useState<ClaimRecovery[]>([]);
  const [selected, setSelected] = useState<ClaimRecovery | null>(null);
  const [user, setUser] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const live = useRef(true),
    locked = useRef(false),
    currentUser = useRef<string | null>(null);
  const pending = useRef<{
    invitationId: string;
    attemptId: string;
    displayName: string;
    requestId: string;
    userId: string;
  } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    live.current = true;
    let active = true,
      sequence = 0;
    const details = confirmationDetails(window.location.hash);
    // Retain the credential only in this component's memory. A reload uses the
    // authenticated attempt projection, never browser-persisted link material.
    window.history.replaceState(null, "", "/auth/confirm");
    queueMicrotask(() => {
      if (active) setCredential(details);
    });
    async function refresh() {
      if (!client) {
        if (active) setChecking(false);
        return;
      }
      const run = ++sequence;
      const { data, error } = await client.auth.getSession();
      if (!active || run !== sequence) return;
      const id = data.session?.user.id || null;
      if (currentUser.current !== id) {
        currentUser.current = id;
        pending.current = null;
        setUncertain(false);
        setName("");
        setSelected(null);
        setAttempts([]);
      }
      setUser(id);
      if (!id) {
        setChecking(false);
        return;
      }
      try {
        if (error)
          throw Error("Your session could not be checked. Please try again.");
        const result = await invoke<{ attempts: ClaimRecovery[] }>(
          client,
          "claim-invitation",
          {
            operation: "recovery",
            ...(details
              ? {
                  invitationId: details.invitationId,
                  attemptId: details.attemptId,
                }
              : {}),
          },
        );
        if (!active || run !== sequence || currentUser.current !== id) return;
        setAttempts(result.attempts);
        setSelected(
          (previous) =>
            result.attempts.find((a) => a.attemptId === previous?.attemptId) ||
            (result.attempts.length === 1 ? result.attempts[0] : null),
        );
      } catch (e) {
        if (active && run === sequence) setMessage(errorText(e));
      } finally {
        if (active && run === sequence) setChecking(false);
      }
    }
    void refresh();
    const subscription = client?.auth.onAuthStateChange((_event, next) => {
      if ((next?.user.id || null) !== currentUser.current && !locked.current)
        queueMicrotask(() => {
          if (active) void refresh();
        });
    }).data.subscription;
    const focus = () => {
      if (!locked.current) void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      live.current = false;
      sequence++;
      subscription?.unsubscribe();
      window.removeEventListener("focus", focus);
    };
  }, [client]);
  async function confirm() {
    if (!client || locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage("");
    try {
      const { data: sessionData, error: sessionError } =
        await client.auth.getSession();
      if (sessionError)
        throw Error("Your session could not be checked. Please try again.");
      let actor = sessionData.session?.user.id || null;
      let target = selected;
      if (!target) {
        if (actor)
          throw Error("Sign out before verifying a different invited mailbox.");
        if (!credential)
          throw Error("Reopen the complete verification link from your email.");
        const { data, error } = await client.auth.verifyOtp({
          token_hash: credential.tokenHash,
          type: credential.type,
        });
        if (error || !data.user)
          throw Error(
            accountRecovery({
              signedIn: false,
              invitation: "valid",
              attempt: "expired",
              sameAccount: false,
            }).message,
          );
        actor = data.user.id;
        currentUser.current = actor;
        if (!live.current) return;
        setUser(actor);
        target = {
          invitationId: credential.invitationId,
          attemptId: credential.attemptId,
          practiceName: "Your inviting practice",
          expiresAt: "",
        };
        setSelected(target);
        setCredential(null);
      }
      if (
        !actor ||
        actor !== currentUser.current ||
        (pending.current && pending.current.userId !== actor)
      )
        throw Error(
          "The signed-in account changed. Reopen your invitation with the correct account.",
        );
      pending.current ??= {
        invitationId: target.invitationId,
        attemptId: target.attemptId,
        displayName: name.trim(),
        requestId: requestId(),
        userId: actor,
      };
      const command = pending.current;
      const result = await invoke<{ applicationId?: string }>(
        client,
        "claim-invitation",
        {
          invitationId: command.invitationId,
          attemptId: command.attemptId,
          displayName: command.displayName,
          requestId: command.requestId,
        },
      );
      if (!live.current) return;
      window.location.assign(result.applicationId ? "/onboarding" : "/");
    } catch (e) {
      if (live.current) {
        setUncertain(Boolean(pending.current));
        setMessage(errorText(e));
      }
    } finally {
      locked.current = false;
      if (live.current) setBusy(false);
    }
  }
  return (
    <WorkflowShell title="Verify your email" compact step={2}>
      <p className="workflow-lead">
        Opening this page does not verify or claim an invitation. Continue only
        if you requested access.
      </p>
      {checking ? (
        <p role="status">Checking your verification link…</p>
      ) : selected || (!user && credential) ? (
        <>
          {selected && (
            <p className="account-next">
              {
                accountRecovery({
                  signedIn: true,
                  invitation: "valid",
                  attempt: "valid",
                  sameAccount: true,
                }).message
              }
            </p>
          )}
          <form
            className="account-form"
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
                disabled={busy || uncertain}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <button className="button primary" disabled={busy || !client}>
              {busy
                ? "Working…"
                : uncertain
                  ? "Retry completing signup"
                  : selected
                    ? "Complete signup"
                    : "Verify and continue"}
            </button>
          </form>
        </>
      ) : attempts.length > 1 ? (
        <section>
          <h2>Choose your invitation</h2>
          {attempts.map((a) => (
            <button
              key={a.attemptId}
              className="button secondary"
              onClick={() => setSelected(a)}
            >
              Continue with {a.practiceName}
            </button>
          ))}
        </section>
      ) : (
        <div className="account-state">
          <h2>
            {user
              ? "No recoverable invitation for this account"
              : "Reopen your verification email"}
          </h2>
          <p>
            {user
              ? "If you already joined, open your workspace. Otherwise sign out and reopen the original invitation for the intended mailbox."
              : "If the verification link expired, reopen your original invitation email to request another. If the invitation itself expired, contact your inviter."}
          </p>
          <a href="/">Open workspace or sign in</a>
        </div>
      )}
      {user && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={async () => {
            if (!client) return;
            const { error } = await client.auth.signOut();
            if (error) setMessage("Sign-out failed. Please try again.");
          }}
        >
          Sign out of this account
        </button>
      )}
      {message && <p role="alert">{message}</p>}
    </WorkflowShell>
  );
}
