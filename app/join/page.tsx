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
} from "../lib/workflow";
export default function JoinPage() {
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [token, setToken] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [completed, setCompleted] = useState<"beginSignup" | "decline" | null>(null);
  const signupRequest = useRef<string | null>(null);
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
    if (!info) return;
    setBusy(true);
    setMessage("");
    try {
      signupRequest.current ??= requestId();
      await invitationEntry({
        operation,
        token,
        termsVersion: info.termsVersion,
        privacyVersion: info.privacyVersion,
        consentAccepted: consent,
        requestId: signupRequest.current,
      });
      setCompleted(operation);
      setMessage(
        operation === "decline"
          ? "Invitation declined. Follow-up invitations are suppressed unless you request another invitation."
          : "Check your invited mailbox for a verification email. Your account has not yet joined a workspace.",
      );
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
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
            <div><dt>Invited email</dt><dd>{info.maskedEmail}</dd></div>
            <div><dt>Expires</dt><dd>{new Date(info.expiresAt).toLocaleString("en-AU")}</dd></div>
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
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>I accept the{" "}
                <a href={info.termsUrl} target="_blank" rel="noreferrer">
                  terms ({info.termsVersion})
                </a>{" "}
                and{" "}
                <a href={info.privacyUrl} target="_blank" rel="noreferrer">
                  privacy policy ({info.privacyVersion})
                </a>
                .</span>
              </label>
              <div className="workflow-actions">
                <button
                  className="button primary"
                  disabled={!consent || busy}
                  onClick={() => void act("beginSignup")}
                >
                  Create my account
                  <ArrowRight size={16} />
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void act("decline")}
                >
                  Decline invitation
                </button>
              </div>
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
          {completed === "beginSignup" ? <Mail size={25} /> : completed === "decline" ? <Check size={25} /> : <AttentionIcon size={25} />}
          {completed && <h2>{completed === "beginSignup" ? "Check your email" : "Invitation declined"}</h2>}
          {!info && <h2>Invitation unavailable</h2>}
          <p>{message}</p>
          {!info && <a href="/">Return to sign in <ArrowRight size={14} /></a>}
        </div>
      )}
    </WorkflowShell>
  );
}
