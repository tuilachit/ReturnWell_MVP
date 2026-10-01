"use client";
import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { invoke, errorText } from "./lib/workflow";
type AccessState = {
  practitionerId: string;
  version: number;
  suspended: boolean;
};
export default function ProfileAccessReview({
  client,
  practitionerId,
}: {
  client: SupabaseClient;
  practitionerId: string;
}) {
  const [state, setState] = useState<AccessState | null>(null);
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const running = useRef(false);
  useEffect(() => {
    let active = true;
    void invoke<AccessState>(client, "review-practitioner", {
      operation: "access_detail",
      practitionerId,
    })
      .then((value) => {
        if (active) setState(value);
      })
      .catch((error) => {
        if (active) setMessage(errorText(error));
      });
    return () => {
      active = false;
    };
  }, [client, practitionerId]);
  return (
    <section className="workflow-card">
      <h3>Clinical access</h3>
      <p>
        Suspension removes clinical access. It is separate from an intake pause
        or a review becoming due. Restoration does not override credential
        eligibility.
      </p>
      {message && <p role="status">{message}</p>}
      {state && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (running.current || !confirmed) return;
            running.current = true;
            setBusy(true);
            setMessage("");
            const payload = {
              operation: state.suspended ? "restore" : "suspend",
              practitionerId,
              expectedVersion: state.version,
              reason,
              evidenceReference: evidence,
            };
            const fingerprint = JSON.stringify(payload);
            if (pending.current?.fingerprint !== fingerprint)
              pending.current = { fingerprint, id: crypto.randomUUID() };
            try {
              setState(
                await invoke<AccessState>(client, "review-practitioner", {
                  ...payload,
                  requestId: pending.current.id,
                }),
              );
              pending.current = null;
              setConfirmed(false);
              setMessage(
                "Access decision recorded in the private audit history.",
              );
            } catch (error) {
              setMessage(errorText(error));
            } finally {
              running.current = false;
              setBusy(false);
            }
          }}
        >
          <p>
            Current state: {state.suspended ? "Suspended" : "Not suspended"}
          </p>
          <fieldset disabled={busy}>
            <label>
              Reason
              <input
                required
                minLength={5}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <label>
              Independent evidence reference
              <input
                required
                minLength={5}
                maxLength={1000}
                value={evidence}
                onChange={(event) => setEvidence(event.target.value)}
              />
            </label>
            <label className="workflow-check">
              <input
                type="checkbox"
                required
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              I have reviewed this access decision and its effect on existing
              referrals.
            </label>
            <button className="button primary" disabled={busy}>
              {state.suspended
                ? "Restore clinical access"
                : "Suspend clinical access"}
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
