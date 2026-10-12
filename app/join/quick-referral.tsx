"use client";
/* Full navigation keeps invitation credentials out of workspace state. */
import { useEffect, useMemo, useRef, useState } from "react";
import WorkflowShell from "../workflow-shell";
import { ArrowRight, Check, LockKeyhole, Mail, ReferralIcon } from "../ui-icons";
import { getSupabaseBrowserClient } from "../lib/supabase";
import {
  errorText,
  invitationEntry,
  invoke,
  requestId,
  type CodeVerification,
  type IntendedIdentity,
  type InvitationInfo,
  WorkflowError,
  isDefinitiveWorkflowFailure,
} from "../lib/workflow";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

// A doctor-selected referral to a reviewed directory practice: email a code to
// the invited address, type it here, then open the referral. No account setup.
export default function QuickReferral({
  info,
  identity,
  token,
}: {
  info: InvitationInfo;
  identity: IntendedIdentity & { quickAccess: true; referralId: string };
  token: string;
}) {
  const client = useMemo(() => getSupabaseBrowserClient(), []);
  const [consent, setConsent] = useState(false);
  const [verification, setVerification] = useState<CodeVerification | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [declined, setDeclined] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const locked = useRef(false);
  const alive = useRef(true);
  const codeField = useRef<HTMLInputElement>(null);
  // Move focus to the code field once the code has been sent.
  useEffect(() => {
    if (verification) codeField.current?.focus();
  }, [verification]);
  // One claim command per verified session, replayed unchanged if uncertain.
  const claim = useRef<Record<string, unknown> | null>(null);
  useEffect(() => {
    alive.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);

  async function run(task: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage("");
    try {
      await task();
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof WorkflowError && error.retryAfterSeconds !== null)
        setRetryAt(Date.now() + error.retryAfterSeconds * 1000);
      setMessage(errorText(error));
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const sendCode = () =>
    run(async () => {
      const result = await invitationEntry<{
        ok: true;
        alreadyRequested?: true;
        verification?: CodeVerification | null;
      }>({
        operation: "beginSignup",
        token,
        termsVersion: info.termsVersion,
        privacyVersion: info.privacyVersion,
        consentAccepted: consent,
        requestId: requestId(),
      });
      if (!alive.current) return;
      if (result.verification) {
        setVerification(result.verification);
        setCode("");
        claim.current = null;
      } else if (!result.alreadyRequested) {
        throw Error(
          "We sent a verification link to your email instead. Open it to continue.",
        );
      }
      setRetryAt(Date.now() + 60_000);
    });

  const openReferral = () =>
    run(async () => {
      if (!client) throw Error("The secure backend is not configured in this build.");
      if (!verification) return;
      let command = claim.current;
      if (!command) {
        const { data, error } = await client.auth.verifyOtp({
          email: verification.email,
          token: code.trim(),
          type: verification.type,
        });
        if (error || !data.session)
          throw Error(
            "That code didn’t work. Check the newest ReturnWell email, or send a new code.",
          );
        command = {
          invitationId: verification.invitationId,
          attemptId: verification.attemptId,
          displayName: identity.displayName,
          requestId: requestId(),
        };
        claim.current = command;
      }
      try {
        await invoke(client, "claim-invitation", command);
      } catch (error) {
        if (isDefinitiveWorkflowFailure(error)) claim.current = null;
        throw error;
      }
      if (!alive.current) return;
      window.location.assign(`/referrals/${identity.referralId}`);
    });

  const decline = () =>
    run(async () => {
      await invitationEntry({ operation: "decline", token });
      if (alive.current) setDeclined(true);
    });

  const waiting = now < retryAt;
  return (
    <WorkflowShell
      title={`Referral from ${info.practiceName}`}
      compact
      recipient
      eyebrow="Secure patient referral"
      aside={
        <>
          <div className="recipient-aside-section">
            <span className="recipient-section-icon">
              <ReferralIcon size={24} />
            </span>
            <h2>How this works</h2>
            <ol className="recipient-next-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Get a code</strong>
                  <p>We email a 6-digit code to {info.maskedEmail}.</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Type it here</strong>
                  <p>No password and no account to set up.</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Review and respond</strong>
                  <p>See the patient details, then accept or decline.</p>
                </div>
              </li>
            </ol>
          </div>
          <div className="recipient-aside-section recipient-reassurance">
            <h3>
              <LockKeyhole size={16} /> Stays private
            </h3>
            <p>
              Patient details are never sent by email. ReturnWell never asks for
              passwords, bank, card or Medicare details.
            </p>
            <p>
              Not expecting this? Check with {info.practiceName} using contact
              details you already trust.
            </p>
          </div>
        </>
      }
    >
      {declined ? (
        <div className="account-state" role="status">
          <Check size={25} />
          <h2>Referral declined</h2>
          <p>
            {info.practiceName} will see that this referral wasn’t accepted.
            ReturnWell won’t send further invitations to this address.
          </p>
        </div>
      ) : !verification ? (
        <>
          <p className="workflow-lead">
            <strong>{info.inviterName}</strong> at {info.practiceName} has referred
            a patient to <strong>{identity.displayName}</strong> at{" "}
            {identity.practiceName}.
          </p>
          <dl className="invitation-details">
            <div>
              <dt>Sent to</dt>
              <dd>{info.maskedEmail}</dd>
            </div>
            <div>
              <dt>Link works until</dt>
              <dd>
                <time dateTime={info.expiresAt}>{when(info.expiresAt)}</time>
              </dd>
            </div>
          </dl>
          <label className="workflow-check">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              I agree to the{" "}
              <a href={info.termsUrl} target="_blank" rel="noreferrer">
                terms
              </a>{" "}
              and{" "}
              <a href={info.privacyUrl} target="_blank" rel="noreferrer">
                privacy policy
              </a>
              .
            </span>
          </label>
          <div className="workflow-actions">
            <button
              className="button primary"
              disabled={!consent || busy || waiting}
              onClick={() => void sendCode()}
            >
              {busy ? "Sending…" : `I’m ${identity.displayName} — email me a code`}
              <Mail size={16} />
            </button>
            <button
              className="button secondary recipient-decline"
              disabled={busy}
              onClick={() => void decline()}
            >
              Not me, or decline
            </button>
          </div>
        </>
      ) : (
        <form
          className="quick-code"
          onSubmit={(event) => {
            event.preventDefault();
            void openReferral();
          }}
        >
          <p className="workflow-lead">
            We sent a code to <strong>{info.maskedEmail}</strong>. It expires at{" "}
            <time dateTime={verification.expiresAt}>{when(verification.expiresAt)}</time>.
          </p>
          <label>
            6-digit code
            <input
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6,10}"
              maxLength={10}
              required
              ref={codeField}
              value={code}
              disabled={busy}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            />
          </label>
          <div className="workflow-actions">
            <button
              className="button primary"
              disabled={busy || code.length < 6}
            >
              {busy ? "Opening…" : "Open referral"}
              <ArrowRight size={16} />
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy || waiting}
              onClick={() => void sendCode()}
            >
              {waiting
                ? `Send a new code in ${Math.ceil((retryAt - now) / 1000)}s`
                : "Send a new code"}
            </button>
          </div>
          <p className="quick-code-hint">
            Can’t find it? Check Spam or Promotions for an email from ReturnWell.
          </p>
        </form>
      )}
      {message && (
        <p className="workflow-message" role="alert">
          {message}
        </p>
      )}
      <footer className="invitation-support">
        <p>Sent by {info.businessName} on behalf of {info.practiceName}</p>
        <p>
          Questions? <a href={`mailto:${info.supportEmail}`}>{info.supportEmail}</a>
        </p>
      </footer>
    </WorkflowShell>
  );
}
