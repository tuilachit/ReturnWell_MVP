"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import WorkflowShell from "./workflow-shell";
import PageState from "./components/page-state";
import ConfirmDialog from "./components/confirm-dialog";
import {
  deliveryProgressLabel,
  invitationProgressLabel,
  type InvitationProgress,
} from "./lib/invitation-progress";
import { errorText, invoke, requestId, WorkflowError } from "./lib/workflow";
type Invitation = {
  id: string;
  kind: string;
  recipient_name: string;
  recipient_email: string;
  status: string;
  expires_at: string;
  version: number;
  signup_completed_at: string | null;
  updated_at: string;
  progress: InvitationProgress;
};
type InvitationProps = {
  client: SupabaseClient;
  organisationId: string | null;
  canInviteDoctor: boolean;
  organisations?: { organisationId: string; organisationName: string }[];
};
export default function Invitations(props: InvitationProps) {
  const [selectedOrganisation, setSelectedOrganisation] = useState<
    string | null
  >(props.organisationId);
  if (!props.organisations) return <InvitationsForm {...props} />;
  return (
    <>
      <section className="workflow-navigation">
        <label>
          Invitation context{" "}
          <select
            value={selectedOrganisation || ""}
            onChange={(event) =>
              setSelectedOrganisation(event.target.value || null)
            }
          >
            <option value="">
              ReturnWell operator — practitioner invitations
            </option>
            {props.organisations.map((organisation) => (
              <option
                key={organisation.organisationId}
                value={organisation.organisationId}
              >
                {organisation.organisationName}
              </option>
            ))}
          </select>
        </label>
        <p>
          Choose a reviewed practice before inviting a doctor. Changing context
          clears the invitation draft.
        </p>
      </section>
      <InvitationsForm
        key={selectedOrganisation || "operator"}
        {...props}
        organisationId={selectedOrganisation}
      />
    </>
  );
}
function InvitationsForm({
  client,
  organisationId,
  canInviteDoctor,
}: {
  client: SupabaseClient;
  organisationId: string | null;
  canInviteDoctor: boolean;
}) {
  const [rows, setRows] = useState<Invitation[]>([]);
  const [inviter, setInviter] = useState<{
    displayName: string;
    practiceName: string;
  } | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState("practitioner");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [confirmation, setConfirmation] = useState<{
    operation: "resend" | "revoke";
    row: Invitation;
  } | null>(null);
  const alive = useRef(true);
  const locked = useRef(false);
  useEffect(() => {
    alive.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);
  const pending = useRef<{
    payload: Record<string, unknown>;
    id: string;
  } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [preview, setPreview] = useState<{
    subject: string;
    text: string;
    fingerprint: string;
  } | null>(null);
  const fingerprint = JSON.stringify([kind, name.trim(), email.trim()]);
  const load = useCallback(async () => {
    const result = await invoke<{
      invitations: Invitation[];
      inviter: typeof inviter;
    }>(client, "manage-invitations", { operation: "list", organisationId });
    if (alive.current) {
      setRows(result.invitations);
      setInviter(result.inviter);
      setNow(Date.now());
    }
  }, [client, organisationId]);
  useEffect(() => {
    let active = true;
    void invoke<{
      invitations: Invitation[];
      inviter: typeof inviter;
    }>(client, "manage-invitations", { operation: "list", organisationId })
      .then((result) => {
        if (active) {
          setRows(result.invitations);
          setInviter(result.inviter);
        }
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
  }, [client, organisationId]);
  async function mutate(operation: string, row?: Invitation) {
    if (locked.current || Date.now() < retryAt) return;
    const retrying = Boolean(pending.current);
    locked.current = true;
    setBusy(true);
    setMessage("");
    try {
      const payload = row
        ? {
            operation,
            invitationId: row.id,
            expectedVersion: row.version,
          }
        : {
            operation,
            organisationId,
            kind,
            recipientName: name.trim(),
            recipientEmail: email.trim(),
            consentConfirmed: consent,
          };
      pending.current ??= { payload, id: requestId() };
      const command = pending.current;
      await invoke(client, "manage-invitations", {
        ...command.payload,
        requestId: command.id,
      });
      if (!alive.current) return;
      pending.current = null;
      setUncertain(false);
      setConfirmation(null);
      setMessage(
        command.payload.operation === "revoke"
          ? "Invitation revoked."
          : "Invitation recorded. Email delivery depends on configured delivery and queue status; this is not a completed signup.",
      );
      if (command.payload.operation === "create") {
        setName("");
        setEmail("");
        setConsent(false);
      }
      await load();
    } catch (error) {
      if (
        !retrying &&
        error instanceof WorkflowError &&
        error.status !== null &&
        error.status < 500
      )
        pending.current = null;
      if (alive.current) {
        setUncertain(Boolean(pending.current));
        if (error instanceof WorkflowError && error.retryAfterSeconds !== null)
          setRetryAt(Date.now() + error.retryAfterSeconds * 1000);
        setMessage(errorText(error));
      }
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <WorkflowShell title="Invite someone you know">
      <p>
        Invite one recipient who has agreed to receive an invitation. Only an
        approved practitioner can receive referrals.
      </p>
      {!loading && !inviter && (
        <p role="alert">
          Your reviewed inviter identity is not configured. An operator must
          verify it before invitations can be created.
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void mutate("create");
        }}
      >
        <fieldset disabled={busy || uncertain || now < retryAt}>
          <label>
            Invitation type
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="practitioner">Practitioner</option>
              {canInviteDoctor && organisationId && (
                <option value="doctor">Doctor joining this practice</option>
              )}
            </select>
          </label>
          <label>
            Recipient name
            <input
              required
              maxLength={160}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Work email
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="workflow-check">
            <input
              type="checkbox"
              required
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            This recipient agreed to receive a ReturnWell invitation.
          </label>
          <aside className="workflow-card">
            <h2>Invitation overview</h2>
            <p>Hello {name || "[recipient name]"},</p>
            <p>
              {inviter?.displayName || "[reviewed inviter]"} at{" "}
              {inviter?.practiceName || "[reviewed practice]"} invites you to{" "}
              {kind === "doctor"
                ? "join their practice on ReturnWell as a referrer"
                : "create a practitioner profile on ReturnWell"}
              .
            </p>
            <p>
              Verify your mailbox
              {kind === "practitioner"
                ? ", confirm your profile and submit it for review before receiving referrals"
                : " to complete signup"}
              . This invitation expires in seven days.
            </p>
            <p>
              The email includes the configured ReturnWell website, business
              identity, support contact, terms, privacy policy and a decline
              option. Sending remains paused if these are not configured.
            </p>
          </aside>
          <button
            type="button"
            className="button secondary"
            disabled={busy || !inviter || !name.trim() || !email.trim()}
            onClick={async () => {
              setBusy(true);
              setMessage("");
              try {
                const result = await invoke<{
                  subject: string;
                  text: string;
                }>(client, "manage-invitations", {
                  operation: "preview",
                  kind,
                  organisationId,
                  recipientName: name.trim(),
                  recipientEmail: email.trim(),
                });
                setPreview({ ...result, fingerprint });
              } catch (error) {
                setMessage(errorText(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            Preview exact email
          </button>
          {preview?.fingerprint === fingerprint && (
            <aside className="workflow-card">
              <h2>{preview.subject}</h2>
              <pre>{preview.text}</pre>
              <p>
                The unique invitation credential is represented by [secure
                invitation link].
              </p>
            </aside>
          )}
          <button
            className="button primary"
            disabled={
              busy ||
              !inviter ||
              !consent ||
              preview?.fingerprint !== fingerprint
            }
          >
            Create invitation
          </button>
        </fieldset>
      </form>
      {message && <p role="status">{message}</p>}
      {now < retryAt && (
        <p role="status">
          Try again in {Math.ceil((retryAt - now) / 1000)} seconds.
        </p>
      )}
      {uncertain && !confirmation && (
        <button
          className="button primary"
          disabled={busy || now < retryAt}
          onClick={() => void mutate("create")}
        >
          Check and retry the same invitation
        </button>
      )}
      <h2>Invitation progress</h2>
      <button
        className="button secondary"
        disabled={busy}
        onClick={() =>
          void load().catch((error) => setMessage(errorText(error)))
        }
      >
        Refresh
      </button>
      {loading ? (
        <PageState kind="loading" title="Loading invitations…" />
      ) : rows.length === 0 ? (
        <PageState
          kind="empty"
          title="No invitations yet"
          description="Invitations you create will appear here with their delivery and signup progress."
        />
      ) : (
        <ul className="workflow-records">
          {rows.map((row) => (
            <li key={row.id}>
              <strong>{row.recipient_name}</strong>
              <p>
                {row.recipient_email} · {row.kind}
              </p>
              <p>{invitationProgressLabel(row.progress, now)}</p>
              <p>{deliveryProgressLabel(row.progress.delivery)}</p>
              {row.progress.signupCompletedAt && (
                <p>
                  Confirmed{" "}
                  {new Date(row.progress.signupCompletedAt).toLocaleString(
                    "en-AU",
                  )}
                  . Practitioner approval and referral acceptance are separate
                  steps.
                </p>
              )}
              {row.progress.delivery.nextRetryAt && (
                <p>
                  Next email retry no earlier than{" "}
                  {new Date(row.progress.delivery.nextRetryAt).toLocaleString(
                    "en-AU",
                  )}
                  .
                </p>
              )}
              {row.status === "pending" && Date.parse(row.expires_at) > now && (
                <div className="workflow-actions">
                  <button
                    className="button secondary"
                    disabled={
                      busy ||
                      uncertain ||
                      now < retryAt ||
                      Date.parse(row.updated_at) + 60000 > now ||
                      row.progress.delivery.state === "suppressed" ||
                      row.progress.delivery.state === "needs_review"
                    }
                    onClick={() =>
                      setConfirmation({ operation: "resend", row })
                    }
                  >
                    Resend with new link
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy || uncertain || now < retryAt}
                    onClick={() =>
                      setConfirmation({ operation: "revoke", row })
                    }
                  >
                    Revoke
                  </button>
                  {Date.parse(row.updated_at) + 60000 > now && (
                    <p>
                      Resend available in{" "}
                      {Math.ceil(
                        (Date.parse(row.updated_at) + 60000 - now) / 1000,
                      )}{" "}
                      seconds.
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirmation !== null}
        title={
          confirmation?.operation === "resend"
            ? "Replace the invitation link?"
            : "Revoke this invitation?"
        }
        description={
          confirmation?.operation === "resend"
            ? "The previous link will stop working. A new email will be queued for the same recipient. Resending does not extend the original expiry or referral consent."
            : "This link will stop working. Any referral waiting on this invitation will remain private and need attention."
        }
        confirmLabel={
          confirmation?.operation === "resend"
            ? "Replace link and queue email"
            : "Revoke invitation"
        }
        busy={busy}
        confirmDisabled={now < retryAt}
        onCancel={() => setConfirmation(null)}
        onConfirm={() =>
          confirmation && void mutate(confirmation.operation, confirmation.row)
        }
      />
    </WorkflowShell>
  );
}
