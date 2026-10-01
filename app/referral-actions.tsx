"use client";
import { useId, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Referral } from "./types";
import type { ReferralDraft } from "./lib/referral-drafts";
import {
  allowedReferralActions,
  cancellationReasons,
  closureReasons,
  startReplacementDraft,
  transitionReferral,
} from "./lib/referral-actions";
import { WorkflowError, errorText, requestId } from "./lib/workflow";
import Field from "./components/field";
import ConfirmDialog from "./components/confirm-dialog";
type Action = "cancel" | "close" | "replace";
type Attempt = {
  referralId: string;
  expectedVersion: number;
  requestId: string;
  action: Action;
  reasonCode: string;
  note: string;
  handoverConfirmed: boolean;
};
export default function ReferralActions({
  client,
  referral,
  onChanged,
  onReplacement,
  onRefresh,
}: {
  client: SupabaseClient;
  referral: Referral;
  onChanged: (referral: Referral) => void;
  onReplacement: (draft: ReferralDraft) => void;
  onRefresh: () => void;
}) {
  const id = useId();
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pending = useRef<Attempt | null>(null);
  const running = useRef(false);
  const [actionVersion, setActionVersion] = useState<number>();
  const actions = allowedReferralActions(referral.status);
  async function submit(selected: Action) {
    if (running.current || referral.version === undefined) return;
    const version = selected === "replace" ? referral.version : actionVersion;
    if (version === undefined) return;
    const attempt = pending.current ?? {
      referralId: referral.id,
      expectedVersion: version,
      requestId: requestId(),
      action: selected,
      reasonCode: reason,
      note: note.trim(),
      handoverConfirmed: confirmed,
    };
    pending.current = attempt;
    running.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (attempt.action === "replace") {
        const draft = await startReplacementDraft(client, {
          referralId: attempt.referralId,
          expectedVersion: attempt.expectedVersion,
          requestId: attempt.requestId,
        });
        pending.current = null;
        setUncertain(false);
        onReplacement(draft);
      } else {
        const result = await transitionReferral(client, {
          ...attempt,
          action: attempt.action,
        });
        pending.current = null;
        setUncertain(false);
        setAction(null);
        setMessage("Change saved. Email status is shown in activity.");
        onChanged(result.referral);
      }
    } catch (failure) {
      if (
        !uncertain &&
        failure instanceof WorkflowError &&
        failure.status !== null &&
        failure.status < 500
      ) {
        pending.current = null;
        setError(errorText(failure));
        if (failure.status === 409) setAction(null);
      } else {
        setUncertain(true);
        setError(
          "We could not confirm whether the change was saved. Check and retry the same request before taking another action.",
        );
      }
    } finally {
      setBusy(false);
      setDialog(false);
      running.current = false;
    }
  }
  return (
    <section className="workflow-section" aria-label="Referral next steps">
      <h2>Next steps</h2>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {uncertain ? (
        <button
          className="button primary"
          disabled={busy}
          onClick={() => pending.current && submit(pending.current.action)}
        >
          {busy ? "Checking…" : "Check and retry change"}
        </button>
      ) : (
        <>
          {!action && (
            <div className="workflow-actions">
              {actions.map((value) => (
                <button
                  type="button"
                  className="button secondary"
                  key={value}
                  disabled={busy || referral.version === undefined}
                  onClick={() => {
                    setError("");
                    setMessage("");
                    setReason("");
                    setNote("");
                    setConfirmed(false);
                    setActionVersion(referral.version);
                    if (value === "replace") void submit(value);
                    else setAction(value);
                  }}
                >
                  {value === "replace"
                    ? "Start replacement referral"
                    : value === "cancel"
                      ? "Cancel referral"
                      : "Close referral"}
                </button>
              ))}
            </div>
          )}
          {actions.length === 0 && (
            <p>
              {referral.status === "closed"
                ? "Coordination is closed. The recorded outcome remains in activity."
                : referral.status === "booked"
                  ? "This is a historical booking record. ReturnWell does not arrange appointments."
                  : "No practice action is available for this state."}
            </p>
          )}
          {action && action !== "replace" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setDialog(true);
              }}
            >
              <Field id={id + "-reason"} label="Reason">
                {(props) => (
                  <select
                    {...props}
                    required
                    disabled={busy}
                    value={reason}
                    onChange={(event) => {
                      setReason(event.target.value);
                      setConfirmed(false);
                    }}
                  >
                    <option value="">Choose a reason</option>
                    {Object.entries(
                      action === "cancel"
                        ? cancellationReasons
                        : closureReasons,
                    ).map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field
                id={id + "-note"}
                label="Coordination note (optional)"
                hint="Up to 500 characters. Visible to referral participants; never included in email."
              >
                {(props) => (
                  <textarea
                    {...props}
                    maxLength={500}
                    value={note}
                    disabled={busy}
                    onChange={(event) => setNote(event.target.value)}
                  />
                )}
              </Field>
              {reason === "handover_completed" && (
                <label className="workflow-check">
                  <input
                    type="checkbox"
                    required
                    checked={confirmed}
                    disabled={busy}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  I confirm the external handover has been completed.
                </label>
              )}
              <div className="workflow-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setAction(null)}
                >
                  Keep referral unchanged
                </button>
                <button className="button primary" disabled={busy || !reason}>
                  {action === "cancel"
                    ? "Review cancellation"
                    : "Review closure"}
                </button>
              </div>
            </form>
          )}
          {error && (
            <button
              type="button"
              className="button secondary"
              onClick={onRefresh}
            >
              Refresh current referral
            </button>
          )}
        </>
      )}
      <ConfirmDialog
        open={dialog}
        title={
          action === "cancel" ? "Cancel this referral?" : "Close this referral?"
        }
        description={
          action === "cancel"
            ? "This stops referral coordination and queues a generic update to the assigned practitioner. The original record stays in activity."
            : "This records your selected outcome. It does not book an appointment or confirm that treatment occurred."
        }
        confirmLabel={
          action === "cancel" ? "Cancel referral" : "Close referral"
        }
        busy={busy}
        onCancel={() => setDialog(false)}
        onConfirm={() => action && void submit(action)}
      />
    </section>
  );
}
