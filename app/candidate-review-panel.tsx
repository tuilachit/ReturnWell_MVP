"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CandidatePage,
  CandidateBatchPage,
  CandidateBatchSummary,
} from "../shared/candidates";
import WorkflowShell from "./workflow-shell";
import CandidateDetailPanel, {
  candidateDispositions,
  dispositionLabel,
} from "./candidate-detail-panel";
import {
  listCandidates,
  listCandidateBatches,
  withdrawCandidateBatch,
} from "./lib/candidates";
import { errorText } from "./lib/workflow";
import { useCandidateAction } from "./lib/use-candidate-action";

function BatchWithdrawal({
  client,
  batch,
  onChanged,
}: {
  client: SupabaseClient;
  batch: CandidateBatchSummary;
  onChanged: () => void;
}) {
  const [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const action = useCandidateAction(onChanged);
  return (
    <section className="workflow-card">
      <h3>Withdraw batch</h3>
      <p>{batch.digest}</p>
      <p>
        {batch.unsupportedOnWithdrawal} candidates would lose their remaining
        source support. Linked applications, clinical records and prior audit
        events remain unchanged. Version {batch.version}.
      </p>
      {action.error && <p role="alert">{action.error}</p>}
      {action.uncertain && (
        <button
          className="button primary"
          disabled={action.busy}
          onClick={action.retry}
        >
          Retry same action
        </button>
      )}
      {action.conflict && (
        <button className="button secondary" onClick={onChanged}>
          Reload batches before a new withdrawal
        </button>
      )}
      <fieldset disabled={action.locked} className="candidate-fields">
        <legend>Confirm withdrawal</legend>
        <label>
          Withdrawal reason
          <textarea
            maxLength={500}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <label className="workflow-check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I understand the affected count and want to withdraw this batch.
        </label>
        <button
          className="button secondary"
          disabled={action.conflict || !confirmed || !reason.trim()}
          onClick={() =>
            action.run(
              {
                batchId: batch.batchId,
                expectedVersion: batch.version,
                reason,
              },
              (value) => withdrawCandidateBatch(client, value),
            )
          }
        >
          Confirm batch withdrawal
        </button>
      </fieldset>
    </section>
  );
}
export default function CandidateReviewPanel({
  client,
}: {
  client: SupabaseClient;
}) {
  const [page, setPage] = useState<CandidatePage | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
      search: "",
      professionId: "",
      suburb: "",
      postcode: "",
      disposition: "",
    }),
    [cursor, setCursor] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [refresh, setRefresh] = useState(0);
  const [batches, setBatches] = useState<CandidateBatchPage | null>(null),
    [batchError, setBatchError] = useState(""),
    [batchCursor, setBatchCursor] = useState<string | undefined>(),
    [withdraw, setWithdraw] = useState<CandidateBatchSummary | null>(null),
    [batchesOpen, setBatchesOpen] = useState(false);
  const generation = useRef(0),
    batchGeneration = useRef(0);
  useEffect(() => {
    const lifecycle = generation;
    const run = ++lifecycle.current;
    queueMicrotask(() => {
      if (run === lifecycle.current) {
        setLoading(true);
        setError("");
        setPage(null);
      }
    });
    const timer = setTimeout(() => {
      void listCandidates(client, {
        ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
        cursor,
      })
        .then((value) => {
          if (run === lifecycle.current) setPage(value);
        })
        .catch((e) => {
          if (run === lifecycle.current) setError(errorText(e));
        })
        .finally(() => {
          if (run === lifecycle.current) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      lifecycle.current++;
    };
  }, [client, filters, cursor, refresh]);
  const loadBatches = useCallback(async () => {
    const run = ++batchGeneration.current;
    setBatchError("");
    try {
      const value = await listCandidateBatches(client, batchCursor);
      if (run === batchGeneration.current) setBatches(value);
    } catch (e) {
      if (run === batchGeneration.current) setBatchError(errorText(e));
    }
  }, [client, batchCursor]);
  useEffect(() => {
    let active = true;
    const lifecycle = batchGeneration;
    queueMicrotask(() => {
      if (active && batchesOpen) void loadBatches();
    });
    return () => {
      active = false;
      lifecycle.current++;
    };
  }, [batchesOpen, loadBatches]);
  function update(key: string, value: string) {
    setCursor(null);
    setFilters((previous) => ({ ...previous, [key]: value }));
  }
  return (
    <WorkflowShell title="Candidate review">
      <p>
        Private research evidence. Onboarding and independent credential review
        are separate from this queue.
      </p>
      {selected ? (
        <CandidateDetailPanel
          key={selected}
          client={client}
          candidateId={selected}
          onChanged={() => setRefresh((x) => x + 1)}
          onClose={() => setSelected(null)}
        />
      ) : (
        <>
          <fieldset className="candidate-fields">
            <legend>Find research records</legend>
            <label>
              Search candidates
              <input
                maxLength={160}
                value={filters.search}
                onChange={(e) => update("search", e.target.value)}
              />
            </label>
            <label>
              Profession ID
              <input
                maxLength={160}
                value={filters.professionId}
                onChange={(e) => update("professionId", e.target.value)}
              />
            </label>
            <label>
              Suburb
              <input
                maxLength={160}
                value={filters.suburb}
                onChange={(e) => update("suburb", e.target.value)}
              />
            </label>
            <label>
              Postcode
              <input
                inputMode="numeric"
                maxLength={4}
                value={filters.postcode}
                onChange={(e) => update("postcode", e.target.value)}
              />
            </label>
            <label>
              Disposition
              <select
                value={filters.disposition}
                onChange={(e) => update("disposition", e.target.value)}
              >
                <option value="">All dispositions</option>
                {candidateDispositions.map((value) => (
                  <option key={value} value={value}>
                    {dispositionLabel(value)}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          {error && <p role="alert">{error}</p>}
          {loading && <p role="status">Loading candidates…</p>}
          {page && (
            <>
              <p>{page.total} candidates</p>
              <ul className="workflow-records">
                {page.items.map((item) => (
                  <li key={item.id}>
                    <strong>{item.displayName}</strong>
                    <p>
                      {item.professionIds.join(", ")} ·{" "}
                      {item.practiceNames.join(", ")}
                    </p>
                    <p>
                      {item.locations
                        .map((l) =>
                          [l.suburb, l.postcode].filter(Boolean).join(" "),
                        )
                        .join("; ")}{" "}
                      · {dispositionLabel(item.disposition)}
                    </p>
                    <button
                      className="button secondary"
                      onClick={() => setSelected(item.id)}
                    >
                      Review {item.displayName}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="workflow-actions">
                <button
                  className="button secondary"
                  disabled={!cursor}
                  onClick={() => setCursor(null)}
                >
                  First candidates
                </button>
                <button
                  className="button secondary"
                  disabled={!page.nextCursor}
                  onClick={() => setCursor(page.nextCursor)}
                >
                  Next candidates
                </button>
              </div>
            </>
          )}
          <details onToggle={(e) => setBatchesOpen(e.currentTarget.open)}>
            <summary>Import batches</summary>
            {batchError && <p role="alert">{batchError}</p>}
            {batches && (
              <ul className="workflow-records">
                {batches.items.map((batch) => (
                  <li key={batch.batchId}>
                    <p>{batch.digest}</p>
                    <p>
                      {batch.recordCount} records · {batch.flaggedCount} flagged
                      · {batch.status} · {batch.importedAt}
                    </p>
                    <button
                      className="button secondary"
                      disabled={
                        batch.status !== "completed" || Boolean(withdraw)
                      }
                      onClick={() => setWithdraw(batch)}
                    >
                      Review batch withdrawal
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {withdraw && (
              <BatchWithdrawal
                key={`${withdraw.batchId}:${withdraw.version}`}
                client={client}
                batch={withdraw}
                onChanged={() => {
                  setWithdraw(null);
                  setRefresh((x) => x + 1);
                  void loadBatches();
                }}
              />
            )}
            <button
              className="button secondary"
              disabled={!batches?.nextCursor || Boolean(withdraw)}
              onClick={() => {
                setBatchCursor(batches!.nextCursor!);
                setBatches(null);
              }}
            >
              Next batches
            </button>
          </details>
        </>
      )}
    </WorkflowShell>
  );
}
