"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import WorkflowShell from "./workflow-shell";
import { errorText, invoke, requestId } from "./lib/workflow";
type Invitation = {
  id: string;
  kind: string;
  recipient_name: string;
  recipient_email: string;
  status: string;
  expires_at: string;
  version: number;
  signup_completed_at: string | null;
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
  const [now] = useState(() => Date.now());
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
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
    setRows(result.invitations);
    setInviter(result.inviter);
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
      const mutationFingerprint = JSON.stringify(payload);
      if (pending.current?.fingerprint !== mutationFingerprint)
        pending.current = { fingerprint: mutationFingerprint, id: requestId() };
      await invoke(client, "manage-invitations", {
        ...payload,
        requestId: pending.current.id,
      });
      pending.current = null;
      setMessage(
        operation === "revoke"
          ? "Invitation revoked."
          : "Invitation recorded. Email delivery depends on configured delivery and queue status; this is not a completed signup.",
      );
      if (!row) {
        setName("");
        setEmail("");
        setConsent(false);
      }
      await load();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
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
            busy || !inviter || !consent || preview?.fingerprint !== fingerprint
          }
        >
          Create invitation
        </button>
      </form>
      {message && <p role="status">{message}</p>}
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
        <p>Loading invitations…</p>
      ) : rows.length === 0 ? (
        <p>No invitations yet.</p>
      ) : (
        <ul className="workflow-records">
          {rows.map((row) => (
            <li key={row.id}>
              <strong>{row.recipient_name}</strong>
              <p>
                {row.recipient_email} · {row.kind}
              </p>
              <p>
                {row.status === "pending" &&
                new Date(row.expires_at).getTime() < now
                  ? "Expired"
                  : row.status}{" "}
                ·{" "}
                {row.signup_completed_at
                  ? `Signup completed ${new Date(row.signup_completed_at).toLocaleString("en-AU")}`
                  : "Signup not completed"}
              </p>
              {row.status === "pending" && (
                <div className="workflow-actions">
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void mutate("resend", row)}
                  >
                    Resend with new link
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void mutate("revoke", row)}
                  >
                    Revoke
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </WorkflowShell>
  );
}
