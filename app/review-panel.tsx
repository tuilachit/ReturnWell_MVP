"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import WorkflowShell from "./workflow-shell";
import PageState from "./components/page-state";
import ProfileSummary from "./components/profile-summary";
import ProfileAccessReview from "./profile-access-review";
import { getProfession } from "./lib/professions";
import { errorText, invoke, requestId, type Application } from "./lib/workflow";
export default function Reviews({ client }: { client: SupabaseClient }) {
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const [rows, setRows] = useState<Application[]>([]);
  const [due, setDue] = useState<
    {
      practitionerId: string;
      displayName: string;
      professionId: string;
      applicationId: string;
      reason: string;
    }[]
  >([]);
  const [selected, setSelected] = useState<Application | null>(null);
  const [reviews, setReviews] = useState<unknown[]>([]);
  const [identity, setIdentity] = useState("");
  const [registration, setRegistration] = useState("");
  const [checkedAt, setCheckedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [matched, setMatched] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [decision, setDecision] = useState("approved");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const alive = useRef(false);
  const locked = useRef(false);
  useEffect(() => {
    let active = true;
    alive.current = true;
    void Promise.all([
      invoke<{
        applications: Application[];
      }>(client, "review-practitioner", { operation: "list" }),
      invoke<{ items: typeof due }>(client, "review-practitioner", {
        operation: "due",
      }),
    ])
      .then(([result, dueResult]) => {
        if (active) {
          setRows(result.applications);
          setDue(dueResult.items);
        }
      })
      .catch((error) => {
        if (active) {
          setMessage(errorText(error));
          setFailed(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      alive.current = false;
    };
  }, [client]);
  async function open(id: string) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setFailed(false);
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
      if (!alive.current) return;
      setSelected(result.application);
      setReviews(result.reviews);
      setIdentity("");
      setRegistration("");
      setCheckedAt("");
      setExpiresAt("");
      setMatched(false);
      setRegistered(false);
      setFeedback("");
    } catch (error) {
      if (!alive.current) return;
      setFailed(true);
      setMessage(errorText(error));
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <WorkflowShell title="Practitioner application reviews">
      <a href="/invitations">Manage invitations</a>
      {message && <p role={failed ? "alert" : "status"}>{message}</p>}
      <p>
        Changes require an independent operator with recent authenticator
        verification.{" "}
        <a href="/security" target="_blank" rel="noreferrer">
          Verify your security session
        </a>{" "}
        in a new tab to keep these edits.
      </p>
      {!loading && due.length > 0 && (
        <section className="workflow-card">
          <h2>Credentials needing review</h2>
          <p>
            Up to 50 outstanding reviews. These practitioners cannot receive new
            referrals until independently re-reviewed. Their existing referral
            history is retained unless access is suspended.
          </p>
          <ul className="workflow-records">
            {due.map((item) => (
              <li key={item.practitionerId}>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void open(item.applicationId)}
                >
                  {item.displayName} · {item.reason.replaceAll("_", " ")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {loading ? (
        <PageState kind="loading" title="Loading applications…" />
      ) : rows.length === 0 ? (
        <PageState
          kind="empty"
          title="No applications to review"
          description="Submitted applications will appear here."
        />
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
          <ProfileSummary profile={selected.profile} />
          <p>
            Submitted version {selected.version}. Review checks must be
            independent of the applicant’s supplied mailbox.
          </p>
          {selected.status === "submitted" && (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (locked.current) return;
                locked.current = true;
                setBusy(true);
                setFailed(false);
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
                      method:
                        getProfession(selected.profile.profession ?? "")
                          ?.route === "professional_body"
                          ? "professional_body_register"
                          : "manual_register",
                      matched: registered,
                      reference: registration,
                      registrationNumber: selected.profile.registrationNumber,
                      expiresAt: expiresAt
                        ? new Date(expiresAt).toISOString()
                        : null,
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
                  if (!alive.current) return;
                  pending.current = null;
                  setSelected(row);
                  setRows((current) =>
                    current.map((item) => (item.id === row.id ? row : item)),
                  );
                  setMessage("Review decision saved.");
                } catch (error) {
                  if (!alive.current) return;
                  setFailed(true);
                  setMessage(errorText(error));
                } finally {
                  locked.current = false;
                  if (alive.current) setBusy(false);
                }
              }}
            >
              <fieldset disabled={busy}>
                <legend>Independent review decision</legend>
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
                  Credential expiry (if stated by the authority)
                  <input
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(event) => setExpiresAt(event.target.value)}
                  />
                </label>
                <p>
                  The approved profession policy sets the next review deadline.
                  An unknown expiry does not remove that deadline.
                </p>
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
              </fieldset>
            </form>
          )}
          <details>
            <summary>Review history ({reviews.length})</summary>
            <pre>{JSON.stringify(reviews, null, 2)}</pre>
          </details>
          {selected.practitioner_id && (
            <ProfileAccessReview
              key={selected.practitioner_id}
              client={client}
              practitionerId={selected.practitioner_id}
            />
          )}
        </section>
      )}
    </WorkflowShell>
  );
}
