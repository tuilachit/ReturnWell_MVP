"use client";
import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import WorkflowShell from "./workflow-shell";
import { invoke, errorText } from "./lib/workflow";
import { useCandidateAction } from "./lib/use-candidate-action";
type Notices = {
  currentTermsVersion: string;
  currentPrivacyVersion: string;
  currentTermsUrl: string;
  currentPrivacyUrl: string;
};
type Registration = {
  ok: true;
  role: "doctor" | "practitioner";
  organisationId: string | null;
  applicationId: string | null;
};
export default function AccountSetupPanel({
  client,
}: {
  client: SupabaseClient;
}) {
  const [role, setRole] = useState<"doctor" | "practitioner">("doctor"),
    [name, setName] = useState(""),
    [practice, setPractice] = useState(""),
    [number, setNumber] = useState(""),
    [consent, setConsent] = useState(false),
    [notices, setNotices] = useState<Notices | null>(null),
    [loadError, setLoadError] = useState("");
  const destination = useRef("/");
  const action = useCandidateAction(() => {
    window.location.assign(destination.current);
  });
  async function refreshNotices() {
    try {
      setNotices(
        await invoke<Notices>(client, "workspace-access", {
          operation: "registration_status",
        }),
      );
      setConsent(false);
      setLoadError("");
    } catch (e) {
      setLoadError(errorText(e));
    }
  }
  useEffect(() => {
    let active = true;
    void invoke<Notices>(client, "workspace-access", {
      operation: "registration_status",
    })
      .then((value) => {
        if (active) setNotices(value);
      })
      .catch((e) => {
        if (active) setLoadError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [client]);
  return (
    <WorkflowShell title="Set up your ReturnWell account" compact>
      <p>
        Choose how you use ReturnWell. You can send referrals as a doctor or
        complete a profile to receive them as a practitioner.
      </p>
      <p>
        Joining an existing practice? Use its invitation instead. A new practice
        workspace is separate, even if its name matches another practice.
      </p>
      {(action.error || loadError) && (
        <p role="alert">{action.error || loadError}</p>
      )}
      {!notices && !loadError && <p role="status">Loading current notices…</p>}
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
        <p>
          Your account may already have a workspace. Return to the workspace
          selector before starting again.
        </p>
      )}
      {(loadError || action.error) && !action.locked && (
        <button
          className="button secondary"
          onClick={() => void refreshNotices()}
        >
          Reload current notices
        </button>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!notices) return;
          action.run(
            {
              role,
              displayName: name,
              ...(role === "doctor"
                ? { practiceName: practice, registrationNumber: number }
                : {}),
              consentConfirmed: consent,
              termsVersion: notices.currentTermsVersion,
              privacyVersion: notices.currentPrivacyVersion,
            },
            async (input) => {
              const result = await invoke<Registration>(
                client,
                "workspace-access",
                { operation: "register", ...input },
              );
              destination.current =
                result.role === "practitioner" ? "/onboarding" : "/";
              return result;
            },
          );
        }}
      >
        <fieldset
          className="candidate-fields"
          disabled={action.locked || !notices}
        >
          <legend>Your account</legend>
          <label className="workflow-check">
            <input
              type="radio"
              name="account-role"
              checked={role === "doctor"}
              onChange={() => setRole("doctor")}
            />
            Doctor — send referrals
          </label>
          <label className="workflow-check">
            <input
              type="radio"
              name="account-role"
              checked={role === "practitioner"}
              onChange={() => setRole("practitioner")}
            />
            Practitioner — receive referrals
          </label>
          <label>
            Full professional name
            <input
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
            />
          </label>
          {role === "doctor" && (
            <>
              <label>
                Practice name
                <input
                  autoComplete="organization"
                  value={practice}
                  onChange={(e) => setPractice(e.target.value)}
                  maxLength={160}
                  required
                />
              </label>
              <label>
                AHPRA registration number
                <input
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  maxLength={40}
                  required
                />
              </label>
              <p>
                Your registration number is self-declared, not independently
                verified. ReturnWell reviews your identity before enabling
                practitioner invitations.
              </p>
            </>
          )}
          {role === "practitioner" && (
            <p>
              You will complete your services, funding, languages, locations and
              referral availability next. Your profile becomes available for
              referrals only after confirmation and independent professional
              review.
            </p>
          )}
          <label className="workflow-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I agree to the{" "}
            <a
              href={notices?.currentTermsUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              terms
            </a>{" "}
            and{" "}
            <a
              href={notices?.currentPrivacyUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              privacy notice
            </a>
            , and confirm these details are accurate.
          </label>
          <button
            className="button primary"
            disabled={
              action.conflict ||
              !consent ||
              !name.trim() ||
              (role === "doctor" && (!practice.trim() || !number.trim()))
            }
          >
            {role === "doctor"
              ? "Create my workspace"
              : "Start my practitioner profile"}
          </button>
        </fieldset>
      </form>
    </WorkflowShell>
  );
}
