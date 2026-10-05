"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CandidateDetail,
  CandidateDisposition,
} from "../shared/candidates";
import {
  disposeCandidate,
  linkCandidateApplication,
  loadCandidate,
  unlinkCandidateApplication,
} from "./lib/candidates";
import { errorText } from "./lib/workflow";
import { useCandidateAction } from "./lib/use-candidate-action";

export const candidateDispositions: CandidateDisposition[] = [
  "unreviewed",
  "needs_clarification",
  "duplicate",
  "unsuitable",
  "reviewed_for_onboarding",
];
export const dispositionLabel = (value: string) => value.replaceAll("_", " ");
function sourceUrl(value: string) {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export default function CandidateDetailPanel({
  client,
  candidateId,
  onChanged,
  onClose,
}: {
  client: SupabaseClient;
  candidateId: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<CandidateDetail | null>(null),
    [readError, setReadError] = useState(""),
    [loading, setLoading] = useState(true);
  const [disposition, setDisposition] =
      useState<CandidateDisposition>("unreviewed"),
    [reason, setReason] = useState(""),
    [evidence, setEvidence] = useState(""),
    [applicationId, setApplicationId] = useState(""),
    [saved, setSaved] = useState("");
  const generation = useRef(0);
  const read = useCallback(
    async (
      cursors: { observationCursor?: string; eventCursor?: string } = {},
    ) => {
      const run = ++generation.current;
      setLoading(true);
      setReadError("");
      try {
        const value = await loadCandidate(client, candidateId, cursors);
        if (run === generation.current) {
          setDetail(value);
          return true;
        }
      } catch (e) {
        if (run === generation.current) setReadError(errorText(e));
      } finally {
        if (run === generation.current) setLoading(false);
      }
      return false;
    },
    [client, candidateId],
  );
  useEffect(() => {
    let active = true;
    const lifecycle = generation;
    queueMicrotask(() => {
      if (active) void read();
    });
    return () => {
      active = false;
      lifecycle.current++;
    };
  }, [read]);
  const action = useCandidateAction(async () => {
    setSaved("Review saved.");
    await read();
    onChanged();
  });
  if (!detail)
    return (
      <section className="workflow-card">
        <p role={readError ? "alert" : "status"}>
          {readError || "Loading research record…"}
        </p>
        <button className="button secondary" onClick={onClose}>
          Back to candidates
        </button>
      </section>
    );
  const record = detail.currentObservation?.record;
  const input = {
    candidateId,
    expectedVersion: detail.version,
    reason,
    ...(evidence.trim() ? { evidenceReference: evidence } : {}),
  };
  return (
    <section className="candidate-detail" aria-label="Candidate details">
      <button
        className="button secondary"
        onClick={onClose}
        disabled={action.locked}
      >
        Back to candidates
      </button>
      <h2>{detail.displayName}</h2>
      <p className="workflow-card">
        Unverified research record — not available for referral.
      </p>
      <dl>
        <dt>Review state</dt>
        <dd>
          {dispositionLabel(detail.disposition)} · Version {detail.version}
          {detail.reviewRequired ? " · Current evidence needs review" : ""}
        </dd>
        <dt>Confirmed practitioner information</dt>
        <dd>
          None established by this research record. Registration, consent,
          services and availability require independent onboarding.
        </dd>
        <dt>Observed profession and practices</dt>
        <dd>
          {detail.professionIds.join(", ") || "Unknown"} ·{" "}
          {detail.practiceNames.join(", ") || "Unknown"}
        </dd>
        <dt>Observed practice locations</dt>
        <dd>
          {detail.locations
            .map((x) =>
              [x.suburb, x.postcode, x.state].filter(Boolean).join(" "),
            )
            .join("; ") || "Unknown"}
        </dd>
        <dt>Source collection date</dt>
        <dd>{record?.observedAt || "Unknown — not supplied by source"}</dd>
        <dt>Import date</dt>
        <dd>{detail.currentObservation?.importedAt || "Unavailable"}</dd>
        <dt>Source URLs</dt>
        <dd>
          {record?.sourceUrls.length
            ? record.sourceUrls.map((value, i) => {
                const safe = sourceUrl(value);
                return (
                  <div key={i}>
                    {safe ? (
                      <a
                        href={safe}
                        target="_blank"
                        rel="noopener noreferrer"
                        referrerPolicy="no-referrer"
                      >
                        {value}
                      </a>
                    ) : (
                      value
                    )}
                  </div>
                );
              })
            : "Unknown"}
        </dd>
        <dt>Research flags</dt>
        <dd>{record?.reviewFlags.join(", ") || "None supplied"}</dd>
      </dl>
      {detail.withdrawn && (
        <p role="status">
          All supporting batches were withdrawn. This record cannot be reviewed
          or newly linked.
        </p>
      )}
      <details>
        <summary>Original observed record</summary>
        <pre>{JSON.stringify(record?.raw ?? {}, null, 2)}</pre>
      </details>
      {(action.error || readError) && (
        <p role="alert">{action.error || readError}</p>
      )}
      {saved && !action.error && <p role="status">{saved}</p>}
      {action.uncertain && (
        <button
          className="button primary"
          onClick={action.retry}
          disabled={action.busy}
        >
          Retry same action
        </button>
      )}
      {action.conflict && (
        <button
          className="button secondary"
          disabled={loading}
          onClick={async () => {
            if (await read()) action.reconciled();
          }}
        >
          Load current version (keep edits)
        </button>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSaved("");
          action.run({ ...input, disposition }, (value) =>
            disposeCandidate(client, value),
          );
        }}
      >
        <fieldset disabled={action.locked} className="candidate-fields">
          <legend>Review research evidence</legend>
          <label>
            Review disposition
            <select
              value={disposition}
              onChange={(e) =>
                setDisposition(e.target.value as CandidateDisposition)
              }
            >
              {candidateDispositions.map((value) => (
                <option value={value} key={value}>
                  {dispositionLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reason
            <textarea
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </label>
          <label>
            Evidence reference
            <input
              maxLength={500}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
            />
          </label>
          <button
            className="button primary"
            disabled={
              action.conflict ||
              detail.withdrawn ||
              !reason.trim() ||
              (disposition === "reviewed_for_onboarding" && !evidence.trim())
            }
          >
            Save review
          </button>
        </fieldset>
      </form>
      <section className="workflow-card">
        <h3>Application evidence link</h3>
        <p>
          This connects evidence to an existing application. It does not approve
          a profile or change its owner.
        </p>
        <a href="/admin/practitioners">Open application reviews</a>
        {detail.linkedApplicationId ? (
          <>
            <p>Linked application: {detail.linkedApplicationId}</p>
            <button
              className="button secondary"
              disabled={
                action.locked ||
                action.conflict ||
                !reason.trim() ||
                !evidence.trim()
              }
              onClick={() => {
                setSaved("");
                action.run(
                  { ...input, applicationId: detail.linkedApplicationId! },
                  (value) => unlinkCandidateApplication(client, value),
                );
              }}
            >
              Remove application link
            </button>
          </>
        ) : (
          <fieldset disabled={action.locked} className="candidate-fields">
            <legend>Link reviewed application</legend>
            <label>
              Application ID
              <input
                value={applicationId}
                onChange={(e) => setApplicationId(e.target.value)}
                maxLength={36}
                placeholder="Application UUID"
              />
            </label>
            <button
              className="button secondary"
              disabled={
                action.conflict ||
                detail.withdrawn ||
                detail.reviewRequired ||
                detail.disposition !== "reviewed_for_onboarding" ||
                !reason.trim() ||
                !evidence.trim() ||
                !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
                  applicationId,
                )
              }
              onClick={() => {
                setSaved("");
                action.run({ ...input, applicationId }, (value) =>
                  linkCandidateApplication(client, value),
                );
              }}
            >
              Link application
            </button>
          </fieldset>
        )}
      </section>
      <details>
        <summary>Observation history</summary>
        <ul className="workflow-records">
          {detail.observations.map((o) => (
            <li key={o.id}>
              {o.importedAt} · {o.active ? "Supported" : "Withdrawn"}
              <pre>{JSON.stringify(o.record, null, 2)}</pre>
            </li>
          ))}
        </ul>
        <button
          className="button secondary"
          disabled={!detail.nextObservationCursor || loading || action.locked}
          onClick={() =>
            void read({ observationCursor: detail.nextObservationCursor! })
          }
        >
          Next observations
        </button>
      </details>
      <details>
        <summary>Review history</summary>
        <ul className="workflow-records">
          {detail.events.map((e) => (
            <li key={e.id}>
              {e.occurredAt} · {e.action}
              <p>{e.reason}</p>
              <p>{e.evidenceReference}</p>
            </li>
          ))}
        </ul>
        <button
          className="button secondary"
          disabled={!detail.nextEventCursor || loading || action.locked}
          onClick={() => void read({ eventCursor: detail.nextEventCursor! })}
        >
          Next review events
        </button>
      </details>
    </section>
  );
}
