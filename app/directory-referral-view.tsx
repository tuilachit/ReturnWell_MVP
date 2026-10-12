"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import WorkflowShell from "./workflow-shell";
import PageState from "./components/page-state";
import CapabilityRequirements from "./components/capability-requirements";
import PatientContactDetail from "./components/patient-contact-detail";
import HandoverPanel from "./handover-panel";
import { normalizeTerm } from "./lib/terminology";
import { referralStatusLabel } from "./lib/referral-status";
import {
  errorText,
  invoke,
  requestId,
  WorkflowError,
  isDefinitiveWorkflowFailure,
} from "./lib/workflow";

type Detail = {
  id: string;
  reference: string;
  status: string;
  version: number;
  referringPractice: string;
  referrerName: string;
  intendedName: string;
  intendedPractice: string;
  patientReference?: string;
  patientPostcode?: string;
  clinicalSummary?: string;
  fundingPath?: string;
  appointmentFormat?: string;
  languageOrAccess?: string | null;
  preferredLanguage?: string;
  accessNotes?: string;
  requiredServiceIds?: string[];
  patientAgeGroupId?: string | null;
  createdAt?: string;
  events?: { type: string; at: string }[];
};

const eventLabel: Record<string, string> = {
  created: "Referral created",
  sent: "Opened to you after email verification",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled by the referring practice",
  closed: "Closed",
};

// One referral opened by verifying a reviewed directory mailbox. Not a member
// workspace: no inbox, profile or directory listing.
export default function DirectoryReferralView({
  client,
  referralId,
  onSignOut,
}: {
  client: SupabaseClient;
  referralId: string;
  onSignOut: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<Record<string, unknown> | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    invoke<Detail>(client, "manage-referral", {
      operation: "recipient.detail",
      referralId,
    })
      .then((data) => {
        if (active) setDetail(data);
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof WorkflowError && error.code === "denied") setDetail(null);
        setMessage(errorText(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, referralId, refresh]);

  async function respond(decision: "accepted" | "declined") {
    if (!detail || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setMessage("");
    const payload = pending.current ?? {
      referralId: detail.id,
      expectedVersion: detail.version,
      decision,
      requestId: requestId(),
      ...(decision === "declined" ? { reasonCode: reason, note: note.trim() } : {}),
    };
    pending.current = payload;
    try {
      const result = await invoke<{ status: string; version: number }>(
        client,
        "respond-to-referral",
        payload,
      );
      if (!mounted.current) return;
      pending.current = null;
      setUncertain(false);
      setDeclining(false);
      setDetail((current) =>
        current ? { ...current, status: result.status, version: result.version } : current,
      );
      setMessage(
        result.status === "accepted"
          ? `Accepted. ${detail.referringPractice} has been notified. Acceptance doesn’t book an appointment — contact the patient using the details above.`
          : `Declined. ${detail.referringPractice} has been notified.`,
      );
      setRefresh((value) => value + 1);
    } catch (error) {
      if (!mounted.current) return;
      if (isDefinitiveWorkflowFailure(error)) {
        pending.current = null;
        setUncertain(false);
      } else setUncertain(true);
      setMessage(errorText(error));
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (loading && !detail)
    return (
      <WorkflowShell title="Opening your referral" recipient compact>
        <PageState kind="loading" title="Loading referral…" />
      </WorkflowShell>
    );
  if (!detail)
    return (
      <WorkflowShell title="Referral unavailable" recipient compact>
        <p role="alert">
          {message ||
            "This referral isn’t available to this account. Open it from the referral email sent to your practice address."}
        </p>
        <button className="button secondary" onClick={onSignOut}>
          Sign out
        </button>
      </WorkflowShell>
    );
  const open = detail.status === "sent";
  return (
    <WorkflowShell
      title={`Referral from ${detail.referringPractice}`}
      recipient
      eyebrow={`For ${detail.intendedName} · ${detail.intendedPractice}`}
    >
      <section className="workflow-card">
        <p className="workflow-lead">
          {detail.referrerName} at {detail.referringPractice} referred this patient
          to you. Status: <strong>{referralStatusLabel(detail.status)}</strong>
        </p>
        {detail.status === "cancelled" ? (
          <p>
            The referring practice cancelled this referral. Patient details are no
            longer shown.
          </p>
        ) : (
          <>
            <dl>
              <div>
                <dt>Reference</dt>
                <dd>
                  {detail.reference}
                  {detail.patientReference ? ` · ${detail.patientReference}` : ""}
                </dd>
              </div>
              <div>
                <dt>Clinical need</dt>
                <dd>{detail.clinicalSummary}</dd>
              </div>
              <CapabilityRequirements
                services={detail.requiredServiceIds ?? []}
                ageGroup={detail.patientAgeGroupId ?? null}
              />
              <div>
                <dt>Postcode</dt>
                <dd>{detail.patientPostcode}</dd>
              </div>
              <div>
                <dt>Funding and format</dt>
                <dd>
                  {normalizeTerm("funding", detail.fundingPath ?? "")?.label ??
                    detail.fundingPath}{" "}
                  · {(detail.appointmentFormat ?? "").replaceAll("_", " ")}
                </dd>
              </div>
              <div>
                <dt>Preferred language</dt>
                <dd>
                  {normalizeTerm("language", detail.preferredLanguage ?? "")?.label ??
                    (detail.preferredLanguage || "Not specified")}
                </dd>
              </div>
              <div>
                <dt>Accessibility notes</dt>
                <dd>{detail.accessNotes || "Not specified"}</dd>
              </div>
            </dl>
            {(open || detail.status === "accepted") && (
              <PatientContactDetail
                key={detail.id + detail.version}
                client={client}
                referralId={detail.id}
                version={detail.version}
              />
            )}
            <HandoverPanel
              key={"handover-" + detail.id + detail.version}
              client={client}
              referralId={detail.id}
              version={detail.version}
            />
          </>
        )}
        {open && !declining && (
          <>
            <p>Accepting means you’ll contact the patient. It doesn’t book an appointment.</p>
            <div className="workflow-actions">
              <button
                className="button primary"
                disabled={busy || uncertain}
                onClick={() => void respond("accepted")}
              >
                Accept referral
              </button>
              <button
                className="button secondary"
                disabled={busy || uncertain}
                onClick={() => setDeclining(true)}
              >
                Decline
              </button>
            </div>
          </>
        )}
        {open && declining && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void respond("declined");
            }}
          >
            <label>
              Reason for declining
              <select
                required
                disabled={busy || uncertain}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              >
                <option value="" disabled>
                  Select a reason
                </option>
                <option value="capacity">No capacity</option>
                <option value="service_not_offered">Service not offered</option>
                <option value="funding_not_supported">Funding not supported</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Note to the referring practice (optional)
              <textarea
                disabled={busy || uncertain}
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <div className="workflow-actions">
              <button className="button primary" disabled={busy || uncertain || !reason}>
                Confirm decline
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy || uncertain}
                onClick={() => {
                  setDeclining(false);
                  setReason("");
                  setNote("");
                }}
              >
                Back
              </button>
            </div>
          </form>
        )}
        {uncertain && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void respond(pending.current?.decision as "accepted" | "declined")}
          >
            Check and retry response
          </button>
        )}
        {message && <p role="status">{message}</p>}
        {detail.events && detail.events.length > 0 && (
          <ol className="workflow-records" aria-label="Referral activity">
            {detail.events.map((event) => (
              <li key={event.type + event.at}>
                {eventLabel[event.type] ?? event.type} ·{" "}
                <time dateTime={event.at}>
                  {new Date(event.at).toLocaleString("en-AU", {
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
      <p className="quick-code-hint">
        This page shows one referral sent to your practice email. You don’t need a
        ReturnWell account. To come back later, open the link in your referral
        email.
      </p>
      <button className="button secondary" onClick={onSignOut}>
        Sign out
      </button>
    </WorkflowShell>
  );
}
