"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import WorkflowShell from "./workflow-shell";
import { errorText, invoke, requestId, type Application } from "./lib/workflow";
export default function Reviews({ client }: { client: SupabaseClient }) {
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const [rows, setRows] = useState<Application[]>([]);
  const [selected, setSelected] = useState<Application | null>(null);
  const [reviews, setReviews] = useState<unknown[]>([]);
  const [identity, setIdentity] = useState("");
  const [registration, setRegistration] = useState("");
  const [checkedAt, setCheckedAt] = useState("");
  const [matched, setMatched] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [decision, setDecision] = useState("approved");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void invoke<{
      applications: Application[];
    }>(client, "review-practitioner", { operation: "list" })
      .then((result) => {
        if (active) setRows(result.applications);
      })
      .catch((error) => {
        if (active) setMessage(errorText(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client]);
  async function open(id: string) {
    setBusy(true);
    setMessage("");
    setSelected(null);
    try {
      const result = await invoke<{
        application: Application;
        reviews: unknown[];
      }>(client, "review-practitioner", {
        operation: "detail",
        applicationId: id,
      });
      setSelected(result.application);
      setReviews(result.reviews);
      setIdentity("");
      setRegistration("");
      setCheckedAt("");
      setMatched(false);
      setRegistered(false);
      setFeedback("");
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkflowShell title="Practitioner application reviews">
      <a href="/invitations">Manage invitations</a>
      {message && <p role="status">{message}</p>}
      {loading ? (
        <p>Loading applications…</p>
      ) : rows.length === 0 ? (
        <p>No applications to review.</p>
      ) : (
        <ul className="workflow-records">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void open(row.id)}
              >
                {row.profile.displayName || "Unnamed applicant"} ·{" "}
                {row.status.replaceAll("_", " ")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <section className="workflow-card">
          <h2>{selected.profile.displayName}</h2>
          <dl>
            {Object.entries(selected.profile).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  {typeof value === "object"
                    ? JSON.stringify(value)
                    : String(value)}
                </dd>
              </div>
            ))}
          </dl>
          <p>
            Submitted version {selected.version}. Review checks must be
            independent of the applicant’s supplied mailbox.
          </p>
          {selected.status === "submitted" && (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setMessage("");
                try {
                  const evidence = {
                    checkedAt: checkedAt
                      ? new Date(checkedAt).toISOString()
                      : null,
                  };
                  const payload = {
                    operation: "decide",
                    applicationId: selected.id,
                    expectedVersion: selected.version,
                    decision,
                    identityEvidence: {
                      ...evidence,
                      method: "independent_practice_contact",
                      matched,
                      reference: identity,
                    },
                    registrationEvidence: {
                      ...evidence,
                      method: "manual_register",
                      matched: registered,
                      reference: registration,
                      registrationNumber: selected.profile.registrationNumber,
                    },
                    applicantFeedback: feedback,
                  };
                  const fingerprint = JSON.stringify(payload);
                  if (pending.current?.fingerprint !== fingerprint)
                    pending.current = { fingerprint, id: requestId() };
                  const row = await invoke<Application>(
                    client,
                    "review-practitioner",
                    { ...payload, requestId: pending.current.id },
                  );
                  pending.current = null;
                  setSelected(row);
                  setRows((current) =>
                    current.map((item) => (item.id === row.id ? row : item)),
                  );
                  setMessage("Review decision saved.");
                } catch (error) {
                  setMessage(errorText(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Decision
                <select
                  value={decision}
                  onChange={(event) => setDecision(event.target.value)}
                >
                  <option value="approved">Approve</option>
                  <option value="changes_requested">Request changes</option>
                  <option value="rejected">Reject</option>
                </select>
              </label>
              <label>
                Independent practice contact evidence
                <input
                  required={decision === "approved"}
                  maxLength={1000}
                  value={identity}
                  onChange={(event) => setIdentity(event.target.value)}
                />
              </label>
              <label className="workflow-check">
                <input
                  type="checkbox"
                  required={decision === "approved"}
                  checked={matched}
                  onChange={(event) => setMatched(event.target.checked)}
                />
                Identity matched through an independently verified practice
                contact
              </label>
              <label>
                Current register evidence reference
                <input
                  required={decision === "approved"}
                  maxLength={1000}
                  value={registration}
                  onChange={(event) => setRegistration(event.target.value)}
                />
              </label>
              <label className="workflow-check">
                <input
                  type="checkbox"
                  required={decision === "approved"}
                  checked={registered}
                  onChange={(event) => setRegistered(event.target.checked)}
                />
                Current registration and professional identity match
              </label>
              <label>
                Checks completed at
                <input
                  type="datetime-local"
                  required={decision === "approved"}
                  value={checkedAt}
                  onChange={(event) => setCheckedAt(event.target.value)}
                />
              </label>
              <label>
                Applicant-visible feedback
                <textarea
                  required={decision !== "approved"}
                  maxLength={1000}
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                />
              </label>
              <button className="button primary" disabled={busy}>
                Record decision
              </button>
            </form>
          )}
          <details>
            <summary>Review history ({reviews.length})</summary>
            <pre>{JSON.stringify(reviews, null, 2)}</pre>
          </details>
        </section>
      )}
    </WorkflowShell>
  );
}
