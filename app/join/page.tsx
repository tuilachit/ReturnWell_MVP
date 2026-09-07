"use client";
import { useEffect, useRef, useState } from "react";
import WorkflowShell from "../workflow-shell";
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
  const [completed, setCompleted] = useState(false);
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
      setCompleted(true);
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
    <WorkflowShell title="You’re invited to ReturnWell">
      {info ? (
        <>
          <p>
            {info.inviterName}
            {info.practiceName
              ? ` at ${info.practiceName}`
              : " from ReturnWell"}{" "}
            invited you, {info.recipientName},{" "}
            {info.kind === "doctor"
              ? "to join their practice workspace."
              : "to create a practitioner profile for review."}
          </p>
          <p>
            Invited mailbox: <strong>{info.maskedEmail}</strong>. Invitation
            expires {new Date(info.expiresAt).toLocaleString("en-AU")}.
          </p>
          <p>
            {info.kind === "practitioner"
              ? "After email verification, you’ll confirm your profile and submit it for review. Approval is required before you can receive referrals."
              : "Verify your invited email to join the named practice as a referrer."}
          </p>
          {!completed && (
            <>
              <label className="workflow-check">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                I accept the{" "}
                <a href={info.termsUrl} target="_blank" rel="noreferrer">
                  terms ({info.termsVersion})
                </a>{" "}
                and{" "}
                <a href={info.privacyUrl} target="_blank" rel="noreferrer">
                  privacy policy ({info.privacyVersion})
                </a>
                .
              </label>
              <div className="workflow-actions">
                <button
                  className="button primary"
                  disabled={!consent || busy}
                  onClick={() => void act("beginSignup")}
                >
                  Create my account
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
          <footer>
            <p>{info.businessName}</p>
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
        !message && <p>Checking invitation…</p>
      )}
      {message && <p role="status">{message}</p>}
    </WorkflowShell>
  );
}
