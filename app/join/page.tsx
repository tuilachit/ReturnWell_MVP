"use client";
/* Full navigation keeps invitation credentials out of workspace state. */
/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useRef, useState } from "react";
import WorkflowShell from "../workflow-shell";
import { ArrowRight, AttentionIcon, Check, Mail } from "../ui-icons";
import {
  errorText,
  invitationEntry,
  requestId,
  type InvitationInfo,
  WorkflowError,
  isDefinitiveWorkflowFailure,
} from "../lib/workflow";
export default function JoinPage() {
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [token, setToken] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [completed, setCompleted] = useState<"beginSignup" | "decline" | null>(
    null,
  );
  const signupRequest = useRef<Record<string, unknown> | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [noticesChanged, setNoticesChanged] = useState(false);
  const locked = useRef(false),
    alive = useRef(true);
  const [retryAt, setRetryAt] = useState(0),
    [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    alive.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    let active = true;
    const value =
      new URLSearchParams(window.location.hash.slice(1)).get("invite") || "";
    queueMicrotask(() => {
      if (active) {
        setToken(value);
        if (!value)
          setMessage(
            "This invitation is unavailable. Ask your inviter for a new link.",
          );
      }
    });
    if (!value) return;
    void invitationEntry<InvitationInfo>({ operation: "inspect", token: value })
      .then((data) => {
        if (active) setInfo(data);
      })
      .catch((error) => {
        if (active) setMessage(errorText(error));
      });
    return () => {
      active = false;
    };
  }, []);
  async function act(operation: "beginSignup" | "decline") {
    if (!info || locked.current || Date.now() < retryAt) return;
    locked.current = true;
    const retrying = Boolean(signupRequest.current);
    setBusy(true);
    setMessage("");
    try {
      signupRequest.current ??= {
        operation,
        token,
        termsVersion: info.termsVersion,
        privacyVersion: info.privacyVersion,
        consentAccepted: consent,
        requestId: requestId(),
      };
      await invitationEntry(signupRequest.current);
      if (!alive.current) return;
      setCompleted(operation);
      setMessage(
        operation === "decline"
          ? "Invitation declined. Follow-up invitations are suppressed unless you request another invitation."
          : "Check your invited mailbox for a verification email. Your account has not yet joined a workspace.",
      );
    } catch (error) {
      if (alive.current) {
        if (!retrying && isDefinitiveWorkflowFailure(error))
          signupRequest.current = null;
        setUncertain(Boolean(signupRequest.current));
        if (error instanceof WorkflowError && error.code === "terms_changed")
          setNoticesChanged(true);
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
    <WorkflowShell title="You’re invited to ReturnWell" compact step={1}>
      {info ? (
        <>
          <p className="workflow-lead">
            <strong>{info.inviterName}</strong>
            {info.practiceName
              ? ` at ${info.practiceName}`
              : " from ReturnWell"}{" "}
            invited you, {info.recipientName},{" "}
            {info.kind === "doctor"
              ? "to join their practice workspace."
              : "to create a practitioner profile for review."}
          </p>
          <dl className="invitation-details">
            <div>
              <dt>Invited email</dt>
              <dd>{info.maskedEmail}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{new Date(info.expiresAt).toLocaleString("en-AU")}</dd>
            </div>
          </dl>
          <div className="account-next">
            <h2>What happens next</h2>
            <p>
              {info.kind === "practitioner"
                ? "After email verification, you’ll confirm your profile and submit it for review. Approval is required before you can receive referrals."
                : "Verify your invited email to join the named practice as a referrer."}
            </p>
          </div>
          {!completed && (
            <>
              <label className="workflow-check">
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={busy || uncertain}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>
                  I accept the{" "}
                  <a href={info.termsUrl} target="_blank" rel="noreferrer">
                    terms ({info.termsVersion})
                  </a>{" "}
                  and{" "}
                  <a href={info.privacyUrl} target="_blank" rel="noreferrer">
                    privacy policy ({info.privacyVersion})
                  </a>
                  .
                </span>
              </label>
              <div className="workflow-actions">
                <button
                  className="button primary"
                  disabled={
                    !consent ||
                    busy ||
                    uncertain ||
                    noticesChanged ||
                    now < retryAt
                  }
                  onClick={() => void act("beginSignup")}
                >
                  Verify my mailbox
                  <ArrowRight size={16} />
                </button>
                <button
                  className="button secondary"
                  disabled={busy || uncertain || now < retryAt}
                  onClick={() => void act("decline")}
                >
                  Decline invitation
                </button>
              </div>
              {uncertain && (
                <button
                  className="button primary"
                  disabled={busy || now < retryAt}
                  onClick={() =>
                    void act(
                      signupRequest.current?.operation === "decline"
                        ? "decline"
                        : "beginSignup",
                    )
                  }
                >
                  Check and retry the same request
                </button>
              )}
              {noticesChanged && !uncertain && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setConsent(false);
                    try {
                      const data = await invitationEntry<InvitationInfo>({
                        operation: "inspect",
                        token,
                      });
                      if (alive.current) {
                        setInfo(data);
                        setNoticesChanged(false);
                        setMessage(
                          "Review the current terms and privacy notice before continuing.",
                        );
                      }
                    } catch (e) {
                      if (alive.current) setMessage(errorText(e));
                    } finally {
                      if (alive.current) setBusy(false);
                    }
                  }}
                >
                  Load current notices
                </button>
              )}
              {now < retryAt && (
                <p role="status">
                  Try again in {Math.ceil((retryAt - now) / 1000)} seconds.
                </p>
              )}
            </>
          )}
          <footer className="invitation-support">
            <p>Sent by {info.businessName}</p>
            <a href={info.websiteUrl} target="_blank" rel="noreferrer">
              Visit ReturnWell independently: {info.websiteUrl}
            </a>
            <p>
              <a href={`mailto:${info.supportEmail}`}>
                Contact {info.supportEmail}
              </a>
            </p>
          </footer>
        </>
      ) : (
        !message && <p role="status">Checking invitation…</p>
      )}
      {message && (
        <div className="account-state" role="status">
          {completed === "beginSignup" ? (
            <Mail size={25} />
          ) : completed === "decline" ? (
            <Check size={25} />
          ) : (
            <AttentionIcon size={25} />
          )}
          {completed && (
            <h2>
              {completed === "beginSignup"
                ? "Check your email"
                : "Invitation declined"}
            </h2>
          )}
          {!info && <h2>Invitation unavailable</h2>}
          <p>{message}</p>
          {!info && (
            <a href="/">
              Return to sign in <ArrowRight size={14} />
            </a>
          )}
        </div>
      )}
    </WorkflowShell>
  );
}
