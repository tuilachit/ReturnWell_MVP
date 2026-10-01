"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import {
  listReferralDrafts,
  loadReferralDraft,
  saveReferralDraft,
  validateDraft,
  type DraftInput,
  type DraftSummary,
  type ReferralDraft,
} from "./lib/referral-drafts";
import { errorText, WorkflowError } from "./lib/workflow";
import ConfirmDialog from "./components/confirm-dialog";
export default function ReferralDraftPanel({
  client,
  organisationId,
  input,
  draft,
  disabled,
  onSaved,
  onLoad,
  onPendingChange,
}: {
  client: SupabaseClient;
  organisationId: string;
  input: DraftInput;
  draft: ReferralDraft | null;
  disabled: boolean;
  onSaved: (draft: ReferralDraft) => void;
  onLoad: (draft: ReferralDraft) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const running = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const mounted = useRef(false);
  const pending = useRef<Parameters<typeof saveReferralDraft>[1] | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    listReferralDrafts(client, organisationId)
      .then((result) => {
        if (active) setDrafts(result.drafts);
      })
      .catch(() => {
        if (active)
          setMessage(
            "Saved drafts could not be loaded. Your current edits are retained.",
          );
      });
    return () => {
      active = false;
    };
  }, [client, organisationId, draft?.version, draft?.id]);
  async function save() {
    if (running.current || disabled) return;
    const retrying = Boolean(pending.current);
    const issues = validateDraft(pending.current?.input ?? input);
    if (issues.length) {
      setMessage(issues[0]);
      return;
    }
    running.current = true;
    setBusy(true);
    const request = pending.current ?? {
      id: draft?.id ?? crypto.randomUUID(),
      organisationId,
      expectedVersion: draft?.version ?? -1,
      input: { ...input },
      requestId: crypto.randomUUID(),
    };
    pending.current = request;
    onPendingChange(true);
    try {
      const saved = await saveReferralDraft(client, request);
      if (!mounted.current) return;
      pending.current = null;
      setUncertain(false);
      onPendingChange(false);
      onSaved(saved);
      setMessage("Draft saved privately. No email was sent.");
    } catch (error) {
      if (
        !retrying &&
        error instanceof WorkflowError &&
        error.status !== null &&
        error.status < 500
      )
        pending.current = null;
      onPendingChange(Boolean(pending.current));
      if (mounted.current) setUncertain(Boolean(pending.current));
      if (mounted.current)
        setMessage(
          pending.current
            ? "Save not confirmed. Check and retry uses the same draft; your edits are retained."
            : errorText(error),
        );
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function load() {
    if (!selected || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const loaded = await loadReferralDraft(client, selected);
      if (!mounted.current) return;
      if (loaded.finalizedReferralId) {
        setMessage(
          "This draft has already been submitted. Open it from your referral list.",
        );
        return;
      }
      pending.current = null;
      setUncertain(false);
      onLoad(loaded);
      setSelected(null);
      setMessage(
        "Saved draft loaded. Confirm consent again before submitting.",
      );
    } catch (error) {
      if (mounted.current) setMessage(errorText(error));
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section className="draft-toolbar" aria-label="Private referral drafts">
      <button
        type="button"
        className="button secondary"
        disabled={busy || disabled}
        onClick={() => void save()}
      >
        {busy ? "Saving…" : uncertain ? "Check and retry draft" : "Save draft"}
      </button>
      <label>
        Resume a saved draft
        <select
          aria-label="Resume a saved draft"
          value=""
          disabled={busy || disabled || uncertain}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Choose a draft…</option>
          {drafts.map((item) => (
            <option key={item.id} value={item.id}>
              {item.patientReference || "Untitled draft"} ·{" "}
              {new Date(item.updatedAt).toLocaleDateString("en-AU")}
            </option>
          ))}
        </select>
      </label>
      {message && <p role="status">{message}</p>}
      <ConfirmDialog
        open={Boolean(selected)}
        title="Load saved draft?"
        description="This replaces the fields currently on screen. Save any changes you want to keep first."
        confirmLabel="Load draft"
        busy={busy}
        onConfirm={() => void load()}
        onCancel={() => setSelected(null)}
      />
    </section>
  );
}
