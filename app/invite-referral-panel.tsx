"use client";
import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  saveReferralDraft,
  validateDraft,
  type DraftInput,
  type ReferralDraft,
} from "./lib/referral-drafts";
import { inviteReferral, type InviteReferral } from "./lib/referral-growth";
import { validateReferralInput } from "./lib/referrals";
import { errorText, isDefinitiveWorkflowFailure } from "./lib/workflow";
import type { ReferralInput } from "./types";
import Field from "./components/field";
export default function InviteReferralPanel({
  client,
  organisationId,
  input,
  draft,
  onPendingChange,
  onSaved,
  onCreated,
}: {
  client: SupabaseClient;
  organisationId: string;
  input: DraftInput;
  draft: ReferralDraft | null;
  onPendingChange: (pending: boolean) => void;
  onSaved: (draft: ReferralDraft) => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [basis, setBasis] = useState("");
  const [contact, setContact] = useState(false),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [message, setMessage] = useState("");
  const alive = useRef(false),
    running = useRef(false);
  const pending = useRef<{
    save: Parameters<typeof saveReferralDraft>[1];
    invite: Omit<InviteReferral, "expectedVersion">;
  } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function send() {
    if (running.current) return;
    const wasPending = Boolean(pending.current);
    const clean = { ...input, selectedPractitionerId: null };
    if (!wasPending) {
      const errors = [
        ...validateDraft(clean),
        ...validateReferralInput({
          ...clean,
          selectionMode: "doctor",
          selectedPractitionerId: "pending",
          consentConfirmed: true,
        } as ReferralInput),
      ];
      if (errors.length) {
        setMessage(errors[0]);
        return;
      }
      if (
        !name.trim() ||
        !email.trim() ||
        !contact ||
        !consent ||
        !["recipient_requested", "documented_permission"].includes(basis)
      ) {
        setMessage(
          "Confirm recipient details, permission to contact and patient consent.",
        );
        return;
      }
    }
    running.current = true;
    setBusy(true);
    setMessage("");
    onPendingChange(true);
    const id = draft?.id ?? crypto.randomUUID();
    const request = pending.current ?? {
      save: {
        id,
        organisationId,
        expectedVersion: draft?.version ?? -1,
        input: clean,
        requestId: crypto.randomUUID(),
      },
      invite: {
        id,
        requestId: crypto.randomUUID(),
        consentConfirmed: true as const,
        contactConsentConfirmed: true as const,
        contactBasis: basis as InviteReferral["contactBasis"],
        recipientName: name.trim(),
        recipientEmail: email.trim(),
      },
    };
    pending.current = request;
    try {
      const saved = await saveReferralDraft(client, request.save);
      if (!alive.current) return;
      onSaved(saved);
      const result = await inviteReferral(client, {
        ...request.invite,
        expectedVersion: saved.version,
      });
      if (!alive.current) return;
      await onCreated(result.referralId);
      pending.current = null;
      onPendingChange(false);
    } catch (error) {
      if (!alive.current) return;
      if (!wasPending && isDefinitiveWorkflowFailure(error))
        pending.current = null;
      setUncertain(Boolean(pending.current));
      onPendingChange(Boolean(pending.current));
      setMessage(
        pending.current
          ? "Invitation not confirmed. Check and retry uses the same referral and invitation. Keep this page open."
          : errorText(error),
      );
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="workflow-card" aria-label="Invite referral recipient">
      <h2>Invite the receiving practitioner</h2>
      <p>
        The referral stays private while the recipient verifies their mailbox
        and completes professional review. It can be released for seven days
        after this confirmation. Sending an invitation does not verify the
        practitioner.
      </p>
      <details open>
        <summary>Review referral details</summary>
        <dl>
          <dt>Patient reference</dt>
          <dd>{input.patientReference}</dd>
          <dt>Clinical summary</dt>
          <dd>{input.clinicalSummary}</dd>
          <dt>Requirements</dt>
          <dd>
            {input.profession} · {input.fundingPath} · {input.appointmentFormat}
          </dd>
        </dl>
      </details>
      {message && <p role="alert">{message}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <fieldset disabled={busy || uncertain}>
          <legend>Recipient and permissions</legend>
          <Field id="invite-referral-name" label="Recipient professional name">
            {(props) => (
              <input
                {...props}
                required
                maxLength={160}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <Field id="invite-referral-email" label="Recipient work email">
            {(props) => (
              <input
                {...props}
                type="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          <Field id="invite-referral-basis" label="Permission to contact">
            {(props) => (
              <select
                {...props}
                required
                value={basis}
                onChange={(event) => setBasis(event.target.value)}
              >
                <option value="">Choose the recorded basis</option>
                <option value="recipient_requested">
                  The recipient requested this invitation
                </option>
                <option value="documented_permission">
                  We have documented permission to invite them
                </option>
              </select>
            )}
          </Field>
          <p>
            A public or scraped email address alone is not permission. This
            invitation includes no clinical content.
          </p>
          <label className="workflow-check">
            <input
              type="checkbox"
              checked={contact}
              onChange={(event) => setContact(event.target.checked)}
            />
            I have permission to send this invitation.
          </label>
          <label className="workflow-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            I confirm patient consent for this referral and its seven-day
            release window.
          </label>
        </fieldset>
        <button
          className="button primary"
          disabled={busy || (!uncertain && (!contact || !consent))}
        >
          {busy
            ? "Saving…"
            : uncertain
              ? "Check and retry invitation"
              : "Save referral and queue invitation"}
        </button>
      </form>
    </section>
  );
}
