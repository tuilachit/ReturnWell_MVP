"use client";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import WorkflowShell from "./workflow-shell";
import PageState from "./components/page-state";
import { emailOperations, type EmailHealthPage } from "./lib/email-operations";
import { deliveryProgressLabel } from "./lib/invitation-progress";
import { errorText } from "./lib/workflow";
import { healthAlerts } from "../supabase/functions/_shared/observability";
export default function EmailOperations({
  client,
}: {
  client: SupabaseClient;
}) {
  const [page, setPage] = useState<EmailHealthPage | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0),
    [cursor, setCursor] = useState<EmailHealthPage["nextCursor"]>(null);
  useEffect(() => {
    let active = true,
      sequence = 0;
    const load = async () => {
      const run = ++sequence;
      setLoading(true);
      setError("");
      try {
        const result = await emailOperations(client, cursor);
        if (active && run === sequence) setPage(result);
      } catch (e) {
        if (active && run === sequence) {
          setPage(null);
          setError(errorText(e));
        }
      } finally {
        if (active && run === sequence) setLoading(false);
      }
    };
    void load();
    window.addEventListener("focus", load);
    return () => {
      active = false;
      sequence++;
      window.removeEventListener("focus", load);
    };
  }, [client, cursor, refresh]);
  return (
    <WorkflowShell title="Email delivery">
      {page?.health && (
        <section className="workflow-card" aria-label="Queue health">
          <h2>Queue health</h2>
          <p>
            Pending {page.health.pendingCount} · Oldest due{" "}
            {Math.round(page.health.oldestPendingSeconds / 60)} minutes · Needs
            review {page.health.needsReviewCount} · Paused{" "}
            {page.health.pausedCount ?? 0}
          </p>
          <p>
            Last completed dispatcher:{" "}
            {page.health.lastDispatchAt
              ? new Date(page.health.lastDispatchAt).toLocaleString("en-AU")
              : "No heartbeat recorded"}
          </p>
          {healthAlerts(page.health).length > 0 && (
            <p role="status">
              Attention:{" "}
              {healthAlerts(page.health)
                .map((code) => code.replaceAll("_", " "))
                .join("; ")}
              .
            </p>
          )}
          <p>
            These are internal warning thresholds, not delivery guarantees.
            External alerts and a named incident owner have not been configured
            for the pilot.
          </p>
        </section>
      )}
      <p>
        Read-only delivery diagnostics. Email delivery does not mean signup,
        professional approval or referral acceptance.
      </p>
      <aside className="workflow-card">
        <h2>Uncertain delivery</h2>
        <p>
          Do not create a replacement email or change its idempotency key. An
          operator must reconcile the provider receipt first. A revoked
          invitation or cancelled referral stays unavailable even if a message
          was already in transit.
        </p>
        <p>
          Use the invitation or referral workflow for permitted cancellation.
          This page cannot send, force-resend or open clinical content.
        </p>
      </aside>
      <div className="workflow-actions">
        <button
          className="button secondary"
          disabled={loading}
          onClick={() => setRefresh((n) => n + 1)}
        >
          Refresh delivery status
        </button>
        <button
          className="button secondary"
          disabled={loading || !cursor}
          onClick={() => setCursor(null)}
        >
          Newest jobs
        </button>
      </div>
      {error ? (
        <PageState
          kind="error"
          title="Delivery status unavailable"
          description={error}
        />
      ) : loading ? (
        <PageState kind="loading" title="Checking delivery status…" />
      ) : page?.jobs.length ? (
        <ul className="workflow-records">
          {page.jobs.map((job) => (
            <li key={job.id}>
              <strong>
                {job.family.replaceAll("_", " ")} · {job.recipientMasked}
              </strong>
              <p>{deliveryProgressLabel(job.delivery)}</p>
              <p>
                Queue: {job.state.replaceAll("_", " ")} · Attempts:{" "}
                {job.attempts}
              </p>
              <p>Updated {new Date(job.updatedAt).toLocaleString("en-AU")}</p>
              {job.delivery.nextRetryAt && (
                <p>
                  Retry no earlier than{" "}
                  {new Date(job.delivery.nextRetryAt).toLocaleString("en-AU")}
                </p>
              )}
              {job.safeErrorCode && (
                <p>Diagnostic: {job.safeErrorCode.replaceAll("_", " ")}</p>
              )}
              <details>
                <summary>Job reference</summary>
                <code>{job.id}</code>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <PageState
          kind="empty"
          title="No email jobs"
          description="Queued application emails will appear here. Supabase Auth SMTP is a separate transport."
        />
      )}
      {page?.nextCursor && (
        <button
          className="button secondary"
          disabled={loading}
          onClick={() => setCursor(page.nextCursor)}
        >
          Older email jobs
        </button>
      )}
    </WorkflowShell>
  );
}
