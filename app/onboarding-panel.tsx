"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import WorkflowShell from "./workflow-shell";
import {
  errorText,
  invoke,
  type Application,
  type Profile,
} from "./lib/workflow";
const split = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
export default function Onboarding({
  client,
  applicationId,
}: {
  client: SupabaseClient;
  applicationId: string;
}) {
  const [application, setApplication] = useState<Application | null>(null);
  const [profile, setProfile] = useState<Partial<Profile>>({});
  const [listText, setListText] = useState({
    services: "",
    funding: "",
    languages: "",
  });
  const [confirmed, setConfirmed] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void invoke<Application>(client, "practitioner-onboarding", {
      operation: "load",
      applicationId,
    })
      .then((row) => {
        if (active) {
          setApplication(row);
          setProfile(row.profile);
          setListText({
            services: (row.profile.services || []).join(", "),
            funding: (row.profile.funding || []).join(", "),
            languages: (row.profile.languages || []).join(", "),
          });
        }
      })
      .catch((error) => {
        if (active) setMessage(errorText(error));
      });
    return () => {
      active = false;
    };
  }, [client, applicationId]);
  const editable =
    application && ["draft", "changes_requested"].includes(application.status);
  async function save(submit: boolean) {
    if (!application) return;
    setBusy(true);
    setMessage("");
    try {
      const saved = await invoke<Application>(
        client,
        "practitioner-onboarding",
        {
          operation: "save",
          applicationId,
          expectedVersion: application.version,
          profile: {
            ...profile,
            services: split(listText.services),
            funding: split(listText.funding),
            languages: split(listText.languages),
          },
        },
      );
      setApplication({
        ...saved,
        current_terms_version: application.current_terms_version,
        current_privacy_version: application.current_privacy_version,
        current_terms_url: application.current_terms_url,
        current_privacy_url: application.current_privacy_url,
      });
      if (submit) {
        const row = await invoke<Application>(
          client,
          "practitioner-onboarding",
          {
            operation: "submit",
            applicationId,
            expectedVersion: saved.version,
            profileConfirmed: confirmed,
            referralConsent: consent,
            termsVersion:
              application.current_terms_version || application.terms_version,
            privacyVersion:
              application.current_privacy_version ||
              application.privacy_version,
          },
        );
        setApplication(row);
      }
      setMessage(
        submit
          ? "Profile submitted for review. Referral access begins only after approval."
          : "Draft saved.",
      );
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  function field<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }
  return (
    <WorkflowShell title="Your practitioner profile">
      {message && <p role="status">{message}</p>}
      {!application ? (
        <p>Loading your application…</p>
      ) : (
        <>
          <p>
            Status: <strong>{application.status.replaceAll("_", " ")}</strong>
          </p>
          {application.applicant_feedback && (
            <aside className="workflow-card">
              <h2>Review feedback</h2>
              <p>{application.applicant_feedback}</p>
            </aside>
          )}
          {application.status === "approved" && (
            <p>
              Your profile is approved.{" "}
              <a href="/practitioner">Open your practitioner workspace</a>.
              Contact ReturnWell support to request a reviewed identity or
              registration change.
            </p>
          )}
          {application.status === "submitted" && (
            <p>
              Your submitted profile is locked while ReturnWell reviews your
              registration and identity.
            </p>
          )}
          {application.status === "rejected" && (
            <p>
              This application has not been approved. Contact ReturnWell support
              using your invitation for help.
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save(true);
            }}
          >
            <fieldset disabled={!editable || busy}>
              <legend>Profile details</legend>
              {(
                [
                  ["displayName", "Full professional name", 160],
                  ["registrationNumber", "Registration number", 40],
                  ["practiceName", "Practice name", 200],
                ] as const
              ).map(([key, label, max]) => (
                <label key={key}>
                  {label}
                  <input
                    required
                    maxLength={max}
                    value={profile[key] || ""}
                    onChange={(event) => field(key, event.target.value)}
                  />
                </label>
              ))}
              <p>
                A registration number is checked manually; entering it does not
                verify your identity.
              </p>
              <label>
                Profession
                <select
                  required
                  value={profile.profession || ""}
                  onChange={(event) =>
                    field(
                      "profession",
                      event.target.value as Profile["profession"],
                    )
                  }
                >
                  <option value="" disabled>
                    Select profession
                  </option>
                  <option value="physiotherapist">Physiotherapist</option>
                  <option value="psychologist">Psychologist</option>
                </select>
              </label>
              {(
                [
                  ["services", "Services", true],
                  ["funding", "Funding accepted", false],
                  ["languages", "Languages", true],
                ] as const
              ).map(([key, label, required]) => (
                <label key={key}>
                  {label} (comma separated)
                  <input
                    required={required}
                    value={listText[key]}
                    onChange={(event) =>
                      setListText((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
              {(
                [
                  ["telehealth", "Do you provide telehealth?"],
                  ["acceptingNewReferrals", "Are you accepting new referrals?"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <select
                    required
                    value={
                      profile[key] === undefined ? "" : String(profile[key])
                    }
                    onChange={(event) =>
                      field(key, event.target.value === "true")
                    }
                  >
                    <option value="" disabled>
                      Select an answer
                    </option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </label>
              ))}
              <h2>Practice locations</h2>
              <p>
                NSW locations only. A location is required if you do not offer
                telehealth. Choose one primary location.
              </p>
              {(profile.locations || []).map((location, index) => (
                <div className="workflow-card" key={index}>
                  <label>
                    Suburb
                    <input
                      required
                      maxLength={120}
                      value={location.suburb}
                      onChange={(event) =>
                        field(
                          "locations",
                          profile.locations!.map((row, i) =>
                            i === index
                              ? { ...row, suburb: event.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Postcode
                    <input
                      required
                      pattern="[0-9]{4}"
                      maxLength={4}
                      value={location.postcode}
                      onChange={(event) =>
                        field(
                          "locations",
                          profile.locations!.map((row, i) =>
                            i === index
                              ? { ...row, postcode: event.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="workflow-check">
                    <input
                      type="radio"
                      name="primary-location"
                      checked={location.isPrimary}
                      onChange={() =>
                        field(
                          "locations",
                          profile.locations!.map((row, i) => ({
                            ...row,
                            isPrimary: i === index,
                          })),
                        )
                      }
                    />
                    Primary location
                  </label>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      const remaining = profile.locations!.filter(
                        (_, i) => i !== index,
                      );
                      if (
                        remaining.length &&
                        !remaining.some((row) => row.isPrimary)
                      )
                        remaining[0] = { ...remaining[0], isPrimary: true };
                      field("locations", remaining);
                    }}
                  >
                    Remove location
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="button secondary"
                disabled={(profile.locations?.length || 0) >= 10}
                onClick={() =>
                  field("locations", [
                    ...(profile.locations || []),
                    {
                      suburb: "",
                      postcode: "",
                      state: "NSW",
                      isPrimary: !profile.locations?.length,
                    },
                  ])
                }
              >
                Add location
              </button>
              {editable && (
                <>
                  <label className="workflow-check">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    I confirm this profile is accurate.
                  </label>
                  <label className="workflow-check">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => setConsent(event.target.checked)}
                    />
                    I agree to receive referrals and accept the current
                    <a
                      href={application.current_terms_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      terms (
                      {application.current_terms_version ||
                        application.terms_version}
                      )
                    </a>
                    and{" "}
                    <a
                      href={application.current_privacy_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      privacy policy (
                      {application.current_privacy_version ||
                        application.privacy_version}
                      )
                    </a>
                    .
                  </label>
                  <div className="workflow-actions">
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => void save(false)}
                    >
                      Save draft
                    </button>
                    <button
                      className="button primary"
                      disabled={
                        !confirmed ||
                        !consent ||
                        !application.current_terms_url ||
                        !application.current_privacy_url
                      }
                    >
                      Submit for review
                    </button>
                  </div>
                </>
              )}
            </fieldset>
          </form>
          {editable && (
            <details>
              <summary>Compare with the current saved version</summary>
              <p>
                Loading the saved version below retains your current form.
                Reload the page only if you want to discard your edits.
              </p>
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    const row = await invoke<Application>(
                      client,
                      "practitioner-onboarding",
                      { operation: "load", applicationId },
                    );
                    setApplication(row);
                    if (
                      row.current_terms_version !==
                        application.current_terms_version ||
                      row.current_privacy_version !==
                        application.current_privacy_version
                    )
                      setConsent(false);
                    setMessage(
                      "Saved version loaded below. Your form is retained; reconcile your edits before saving.",
                    );
                  } catch (error) {
                    setMessage(errorText(error));
                  }
                }}
              >
                Load saved version
              </button>
              <pre>{JSON.stringify(application.profile, null, 2)}</pre>
            </details>
          )}
        </>
      )}
    </WorkflowShell>
  );
}
