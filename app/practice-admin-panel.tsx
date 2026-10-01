"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import WorkflowShell from "./workflow-shell";
import Field from "./components/field";
import ConfirmDialog from "./components/confirm-dialog";
import {
  managePractice,
  type PracticeCommand,
  type PracticeRecord,
  type PracticeMember,
} from "./lib/practice-admin";
import { errorText, isDefinitiveWorkflowFailure } from "./lib/workflow";
type WriteCommand = Exclude<PracticeCommand, { operation: "list" }>;
const emptyContact = { phone: "", email: "", instructions: "", evidence: "" };
export default function PracticeAdmin({ client }: { client: SupabaseClient }) {
  const [practices, setPractices] = useState<PracticeRecord[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [record, setRecord] = useState<PracticeRecord | null>(null),
    [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [name, setName] = useState(""),
    [owner, setOwner] = useState(""),
    [evidence, setEvidence] = useState("");
  const [contact, setContact] = useState(emptyContact),
    [dirty, setDirty] = useState(false);
  const [member, setMember] = useState<PracticeMember | null>(null),
    [mode, setMode] = useState<"identity" | "revoke">("identity");
  const [displayName, setDisplayName] = useState(""),
    [memberEvidence, setMemberEvidence] = useState(""),
    [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState<WriteCommand | null>(null),
    [uncertain, setUncertain] = useState<WriteCommand | null>(null);
  const alive = useRef(true),
    lock = useRef(false),
    loadRun = useRef(0);
  const install = useCallback((value: PracticeRecord) => {
    setRecord(value);
    setContact({
      phone: value.contact?.phone || "",
      email: value.contact?.email || "",
      instructions: value.contact?.instructions || "",
      evidence: "",
    });
    setDirty(false);
    setCreating(false);
    setMember(null);
    setMemberEvidence("");
    setReason("");
  }, []);
  const open = useCallback(
    async (id: string) => {
      const run = ++loadRun.current;
      setLoading(true);
      try {
        const result = await managePractice(client, {
          operation: "list",
          organisationId: id,
        });
        if (alive.current && run === loadRun.current) {
          if (!result.practices?.[0])
            throw Error("This practice is unavailable.");
          install(result.practices[0]);
          window.history.replaceState(
            null,
            "",
            `/admin/practices?practice=${encodeURIComponent(id)}`,
          );
        }
      } finally {
        if (alive.current && run === loadRun.current) setLoading(false);
      }
    },
    [client, install],
  );
  const list = useCallback(
    async (next?: string) => {
      const result = await managePractice(client, {
        operation: "list",
        ...(next ? { cursor: next } : {}),
      });
      if (alive.current) {
        setPractices((current) =>
          next
            ? [...current, ...(result.practices || [])]
            : result.practices || [],
        );
        setCursor(result.nextCursor || null);
      }
    },
    [client],
  );
  useEffect(() => {
    const generation = loadRun;
    alive.current = true;
    void (async () => {
      try {
        await list();
        const selected = new URLSearchParams(window.location.search).get(
          "practice",
        );
        if (alive.current && selected && /^[0-9a-f-]{36}$/i.test(selected))
          await open(selected);
      } catch (e) {
        if (alive.current) setError(errorText(e));
      } finally {
        if (alive.current) setLoading(false);
      }
    })();
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, [list, open]);
  useEffect(() => {
    if (!dirty && !uncertain) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, uncertain]);
  async function perform(command: WriteCommand) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    let committed = false;
    try {
      const result = await managePractice(client, command);
      committed = true;
      if (!alive.current) return;
      setUncertain(null);
      setConfirmation(null);
      setDirty(false);
      const id =
        command.operation === "create"
          ? result.organisationId
          : command.organisationId;
      if (id) await open(id);
      await list();
      if (alive.current)
        setMessage(
          command.operation === "reviewContact"
            ? "Reviewed contact saved."
            : command.operation === "create"
              ? "Practice created. Review the work contact and inviter identity next."
              : command.operation === "reviewInviter"
                ? "Inviter identity reviewed."
                : "Access removed. Pending invitations from this member were revoked.",
        );
    } catch (e) {
      if (alive.current) {
        setError(
          committed
            ? "The change was saved, but the refreshed view could not load. Reload the saved practice."
            : errorText(e),
        );
        if (!committed && !isDefinitiveWorkflowFailure(e))
          setUncertain(command);
        setConfirmation(null);
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const disabled = busy || Boolean(uncertain);
  function changeContact(field: keyof typeof contact, value: string) {
    setContact({ ...contact, [field]: value });
    setDirty(true);
  }
  function submit(event: FormEvent, command: WriteCommand) {
    event.preventDefault();
    void perform(command);
  }
  return (
    <WorkflowShell title="Practice administration">
      <p>
        Independently review practice identity, work contacts and membership.
        This workspace contains no referral summaries.
      </p>
      <p>
        <a href="/security" target="_blank" rel="noreferrer">
          Verify account security in another tab
        </a>{" "}
        before editing. Your current form stays open.
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {uncertain && (
        <div className="workflow-card">
          <p>
            The result is not confirmed. Retry the same request before making
            another change.
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void perform(uncertain)}
          >
            Check and retry change
          </button>
        </div>
      )}
      <div className="workflow-actions">
        <button
          className="button primary"
          disabled={disabled || dirty}
          onClick={() => {
            loadRun.current++;
            setCreating(true);
            setRecord(null);
            setError("");
            setMessage("");
            setName("");
            setOwner("");
            setEvidence("");
            window.history.replaceState(null, "", "/admin/practices");
          }}
        >
          New practice
        </button>
      </div>
      {loading && <p role="status">Loading practice records…</p>}
      {!creating && !record && (
        <>
          <h2>Reviewed practices</h2>
          {!loading && !practices.length && (
            <p>No practices have been created.</p>
          )}
          <ul className="workflow-records">
            {practices.map((p) => (
              <li key={p.id}>
                <button
                  className="button secondary"
                  disabled={disabled}
                  onClick={() => {
                    setError("");
                    void open(p.id).catch((e) => setError(errorText(e)));
                  }}
                >
                  {p.name}
                </button>
                <p>
                  {p.contact
                    ? "Work contact reviewed"
                    : "Work contact not reviewed"}
                </p>
              </li>
            ))}
          </ul>
          {cursor && (
            <button
              className="button secondary"
              disabled={disabled}
              onClick={() =>
                void list(cursor).catch((e) => setError(errorText(e)))
              }
            >
              More practices
            </button>
          )}
        </>
      )}
      {creating && (
        <form
          className="workflow-card"
          onSubmit={(event) =>
            submit(event, {
              operation: "create",
              name,
              ownerUserId: owner.trim(),
              evidenceReference: evidence,
              requestId: crypto.randomUUID(),
            })
          }
        >
          <h2>New practice</h2>
          <fieldset disabled={disabled}>
            <Field id="practice-name" label="Practice name">
              {(props) => (
                <input
                  {...props}
                  required
                  maxLength={160}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setDirty(true);
                  }}
                />
              )}
            </Field>
            <Field
              id="practice-owner"
              label="Verified owner account ID"
              hint="The existing account must have verified its email. You cannot review yourself."
            >
              {(props) => (
                <input
                  {...props}
                  required
                  pattern="[0-9a-fA-F-]{36}"
                  value={owner}
                  onChange={(e) => {
                    setOwner(e.target.value);
                    setDirty(true);
                  }}
                />
              )}
            </Field>
            <Field
              id="practice-owner-evidence"
              label="Independent evidence reference"
              hint="Record the identity/authority check, not credentials or patient information."
            >
              {(props) => (
                <input
                  {...props}
                  required
                  maxLength={500}
                  value={evidence}
                  onChange={(e) => {
                    setEvidence(e.target.value);
                    setDirty(true);
                  }}
                />
              )}
            </Field>
            <button className="button primary">Create practice</button>
          </fieldset>
        </form>
      )}
      {record && (
        <>
          <h2>{record.name}</h2>
          <p>Practice ID: {record.id}</p>
          <form
            className="workflow-card"
            onSubmit={(event) =>
              submit(event, {
                operation: "reviewContact",
                organisationId: record.id,
                expectedVersion: record.version,
                contactPhone: contact.phone,
                contactEmail: contact.email,
                secureInstructions: contact.instructions,
                evidenceReference: contact.evidence,
                requestId: crypto.randomUUID(),
              })
            }
          >
            <h3>Reviewed work contact</h3>
            <p>
              {record.contact
                ? "Only save after independently checking the updated details."
                : "No reviewed handover contact is available yet."}
            </p>
            <fieldset disabled={disabled || Boolean(member)}>
              <Field id="practice-phone" label="Work phone">
                {(props) => (
                  <input
                    {...props}
                    type="tel"
                    maxLength={60}
                    value={contact.phone}
                    onChange={(e) => changeContact("phone", e.target.value)}
                  />
                )}
              </Field>
              <Field
                id="practice-email"
                label="Work notification email"
                hint="Optional. Generic coordination notices only; never clinical content."
              >
                {(props) => (
                  <input
                    {...props}
                    type="email"
                    maxLength={254}
                    value={contact.email}
                    onChange={(e) => changeContact("email", e.target.value)}
                  />
                )}
              </Field>
              <Field
                id="practice-instructions"
                label="Secure handover instructions"
                hint="Provide a phone number or instructions for an approved external handover channel."
              >
                {(props) => (
                  <textarea
                    {...props}
                    maxLength={1000}
                    value={contact.instructions}
                    onChange={(e) =>
                      changeContact("instructions", e.target.value)
                    }
                  />
                )}
              </Field>
              <Field
                id="practice-contact-evidence"
                label="Contact evidence reference"
              >
                {(props) => (
                  <input
                    {...props}
                    required
                    maxLength={500}
                    value={contact.evidence}
                    onChange={(e) => changeContact("evidence", e.target.value)}
                  />
                )}
              </Field>
              <button className="button primary">Save reviewed contact</button>
            </fieldset>
          </form>
          <h3>Practice members</h3>
          <ul className="workflow-records">
            {record.members.map((item) => (
              <li key={item.id}>
                <strong>{item.inviterName || item.email}</strong>
                <p>
                  {item.role} · {item.active ? "Active" : "Access removed"}
                </p>
                <p>Account ID: {item.userId}</p>
                {item.active && (
                  <div className="workflow-actions">
                    <button
                      className="button secondary"
                      disabled={disabled || dirty}
                      onClick={() => {
                        setMode("identity");
                        setMember(item);
                        setDisplayName(item.inviterName || "");
                        setMemberEvidence("");
                      }}
                    >
                      Review inviter identity
                    </button>
                    <button
                      className="button secondary"
                      disabled={disabled || dirty}
                      onClick={() => {
                        setMode("revoke");
                        setMember(item);
                        setReason("");
                      }}
                    >
                      Remove access
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {record.nextMemberCursor && (
            <button
              className="button secondary"
              disabled={disabled || dirty}
              onClick={() =>
                void managePractice(client, {
                  operation: "list",
                  organisationId: record.id,
                  memberCursor: record.nextMemberCursor!,
                })
                  .then((result) => {
                    const next = result.practices?.[0];
                    if (next && alive.current)
                      setRecord({
                        ...record,
                        members: [...record.members, ...next.members],
                        nextMemberCursor: next.nextMemberCursor,
                      });
                  })
                  .catch((e) => setError(errorText(e)))
              }
            >
              More members
            </button>
          )}
          {member && (
            <form
              className="workflow-card"
              onSubmit={(event) => {
                event.preventDefault();
                const command: WriteCommand =
                  mode === "identity"
                    ? {
                        operation: "reviewInviter",
                        organisationId: record.id,
                        memberId: member.id,
                        expectedVersion: record.version,
                        displayName,
                        evidenceReference: memberEvidence,
                        requestId: crypto.randomUUID(),
                      }
                    : {
                        operation: "revokeMember",
                        organisationId: record.id,
                        memberId: member.id,
                        expectedVersion: member.version,
                        reason,
                        requestId: crypto.randomUUID(),
                      };
                if (mode === "revoke") setConfirmation(command);
                else void perform(command);
              }}
            >
              <h3>
                {mode === "identity"
                  ? "Review inviter identity"
                  : "Remove practice access"}
              </h3>
              <p>{member.email}</p>
              <fieldset disabled={disabled}>
                {mode === "identity" ? (
                  <>
                    <Field
                      id="member-reviewed-name"
                      label="Reviewed inviter name"
                    >
                      {(props) => (
                        <input
                          {...props}
                          required
                          maxLength={160}
                          value={displayName}
                          onChange={(e) => {
                            setDisplayName(e.target.value);
                            setDirty(true);
                          }}
                        />
                      )}
                    </Field>
                    <Field
                      id="member-evidence"
                      label="Identity evidence reference"
                    >
                      {(props) => (
                        <input
                          {...props}
                          required
                          maxLength={500}
                          value={memberEvidence}
                          onChange={(e) => {
                            setMemberEvidence(e.target.value);
                            setDirty(true);
                          }}
                        />
                      )}
                    </Field>
                  </>
                ) : (
                  <Field id="removal-reason" label="Reason for removal">
                    {(props) => (
                      <textarea
                        {...props}
                        required
                        maxLength={500}
                        value={reason}
                        onChange={(e) => {
                          setReason(e.target.value);
                          setDirty(true);
                        }}
                      />
                    )}
                  </Field>
                )}
                <button className="button primary">
                  {mode === "identity"
                    ? "Save reviewed identity"
                    : "Review removal"}
                </button>
              </fieldset>
            </form>
          )}
        </>
      )}
      {(record || creating) && (
        <div className="workflow-actions">
          <button
            className="button secondary"
            disabled={disabled}
            onClick={() => {
              if (record) install(record);
              else {
                setName("");
                setOwner("");
                setEvidence("");
                setDirty(false);
              }
              setMember(null);
            }}
          >
            Discard unsaved edits
          </button>
          {record && (
            <button
              className="button secondary"
              disabled={disabled || dirty}
              onClick={() =>
                void open(record.id).catch((e) => setError(errorText(e)))
              }
            >
              Reload saved practice
            </button>
          )}
          <button
            className="button secondary"
            disabled={disabled || dirty}
            onClick={() => {
              setRecord(null);
              setCreating(false);
              setMember(null);
              setError("");
              window.history.replaceState(null, "", "/admin/practices");
            }}
          >
            All practices
          </button>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(confirmation)}
        title="Remove this member's access?"
        description="Existing sessions will lose practice access immediately. Pending invitations they sent for this practice will be revoked. Referral records are retained."
        confirmLabel="Remove access"
        busy={busy}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => confirmation && void perform(confirmation)}
      />
    </WorkflowShell>
  );
}
