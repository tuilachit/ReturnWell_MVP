"use client";
import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  referralGrowth,
  growthLabels,
  growthReasons,
  type ReferralGrowth,
} from "./lib/referral-growth";
import { errorText, invoke, isDefinitiveWorkflowFailure, notificationLabel } from "./lib/workflow";
import ConfirmDialog from "./components/confirm-dialog";
export default function ReferralGrowthPanel({
  client,
  referralId,
  version,
  onChanged,
}: {
  client: SupabaseClient;
  referralId: string;
  version?: number;
  onChanged: () => void;
}) {
  const [progress, setProgress] = useState<ReferralGrowth | null>(null),
    [message, setMessage] = useState(""),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const alive = useRef(false),
    running = useRef(false),
    request = useRef<{
      operation: string;
      referralId: string;
      expectedVersion: number;
      requestId: string;
      consentConfirmed: true;
    } | null>(null);
  useEffect(() => {
    let active = true;
    alive.current = true;
    let sequence = 0;
    const load = () => {
      const turn = ++sequence;
      void referralGrowth(client, referralId)
        .then((value) => {
          if (active && turn === sequence) setProgress(value);
        })
        .catch(() => {
          if (active && turn === sequence)
            setMessage(
              "Onboarding progress could not be checked. Refresh to try again.",
            );
        });
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      active = false;
      alive.current = false;
      window.removeEventListener("focus", load);
    };
  }, [client, referralId, version, refresh]);
  async function reconfirm() {
    if (!progress || running.current) return;
    running.current = true;
    setBusy(true);
    const wasPending = Boolean(request.current);
    request.current ??= {
      operation: "onboarding.reconfirm",
      referralId,
      expectedVersion: progress.version,
      requestId: crypto.randomUUID(),
      consentConfirmed: true,
    };
    try {
      await invoke(client, "manage-referral", request.current);
      if (!alive.current) return;
      request.current = null;
      setMessage("");
      setConfirm(false);
      setRefresh((n) => n + 1);
      onChanged();
    } catch (error) {
      if (!wasPending && isDefinitiveWorkflowFailure(error))
        request.current = null;
      if (alive.current) setMessage(errorText(error));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  if (!progress && !message) return null;
  return (
    <section className="workflow-card">
      <h2>Referral onboarding</h2>
      {message && <p role="alert">{message}</p>}
      {progress && (
        <>
          <p>
            <strong>{growthLabels[progress.status]}</strong>
          </p>
          <p>
            {progress.recipientName} · {progress.recipientEmail}
          </p>
          <p>{notificationLabel({kind:'invitation',status:progress.invitationNotification??'pending'})}</p>
          {progress.reason && (
            <p>
              {growthReasons[progress.reason] ??
                "Review this referral before release."}
            </p>
          )}
          <p>
            Consent window ends{" "}
            {new Date(progress.consentValidUntil).toLocaleString("en-AU")}.
            Resending an invitation does not extend it.
          </p>
          {progress.signupCompletedAt && (
            <p>
              {progress.accountWasNew
                ? "New account verified"
                : "Existing account verified"}{" "}
              — this is separate from professional approval.
            </p>
          )}
          {progress.status === "needs_reconfirmation" &&
            progress.invitationStatus === "claimed" && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => setConfirm(true)}
              >
                Review and reconfirm release
              </button>
            )}
        </>
      )}
      <button
        className="button secondary"
        disabled={busy}
        onClick={() => {
          setMessage("");
          setRefresh((n) => n + 1);
        }}
      >
        Refresh onboarding progress
      </button>
      <ConfirmDialog
        open={confirm}
        busy={busy}
        title="Reconfirm referral release?"
        description="Review the clinical summary and requirements above. Confirm current patient consent for another seven-day release window. The same intended recipient must still pass every eligibility check; this does not reroute the referral."
        confirmLabel="Confirm consent and recheck"
        onConfirm={() => void reconfirm()}
        onCancel={() => setConfirm(false)}
      />
    </section>
  );
}
