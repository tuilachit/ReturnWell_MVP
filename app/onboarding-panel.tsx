"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import WorkflowShell from "./workflow-shell";
import PageState from "./components/page-state";
import TermChecklist from "./components/term-checklist";
import Field from "./components/field";
import ConfirmDialog from "./components/confirm-dialog";
import ProfileSummary from "./components/profile-summary";
import { getProfession, professions } from "./lib/professions";
import {
  validateProfile,
  canConfirmProfile,
  type FieldIssue,
} from "./lib/profile-validation";
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
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [comparison, setComparison] = useState<Application | null>(null);
  const [rebase, setRebase] = useState(false);
  const [dirty, setDirty] = useState(false);
  const alive = useRef(false);
  const locked = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const issue = (key: string) =>
    issues.find((item) => item.field === key)?.message;
  const policies = application?.professionPolicies ?? [];
  const choices = professions.filter(
    (p) =>
      p.scope === "supported" ||
      p.id === profile.profession ||
      policies.some(
        (policy) =>
          policy.professionId === p.id && policy.scope === "supported",
      ),
  );
  const canonical = () => ({
    ...profile,
    services: split(listText.services),
    funding: split(listText.funding),
    languages: split(listText.languages),
  });
  const notices = (row: Application) => ({
    intendedIdentity: row.intendedIdentity,
    current_terms_version: row.current_terms_version,
    current_privacy_version: row.current_privacy_version,
    current_terms_url: row.current_terms_url,
    current_privacy_url: row.current_privacy_url,
    professionPolicies: row.professionPolicies,
  });
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  useEffect(() => {
    let active = true;
    alive.current = true;
    void invoke<Application>(client, "practitioner-onboarding", {
      operation: "load",
      applicationId,
    })
      .then((row) => {
        if (active) {
          setApplication(row);
          setFailed(false);
          setMessage("");
          setProfile(row.profile);
          setListText({
            services: (row.profile.services || []).join(", "),
            funding: (row.profile.funding || []).join(", "),
            languages: (row.profile.languages || []).join(", "),
          });
        }
      })
      .catch((error) => {
        if (active) {
          setMessage(errorText(error));
          setFailed(true);
        }
      });
    return () => {
      active = false;
      alive.current = false;
    };
  }, [client, applicationId, retry]);
  const editable =
    application && ["draft", "changes_requested"].includes(application.status);
  async function save(submit: boolean) {
    if (!application || locked.current || !editable) return;
    const payload = canonical();
    const validation = validateProfile(payload, policies, submit);
    setIssues(validation);
    if (validation.length) {
      setFailed(true);
      setMessage(
        "Check the highlighted fields. Your edits have not been lost.",
      );
      requestAnimationFrame(() => {
        form.current?.querySelectorAll("details").forEach((element) => {
          element.open = true;
        });
        form.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus();
      });
      return;
    }
    if (
      submit &&
      !canConfirmProfile(application, {
        profileConfirmed: confirmed,
        referralConsent: consent,
        termsVersion: application.current_terms_version,
        privacyVersion: application.current_privacy_version,
      })
    ) {
      setFailed(true);
      setMessage(
        "Review the current notices and confirm your profile before submitting.",
      );
      return;
    }
    locked.current = true;
    setBusy(true);
    setFailed(false);
    setMessage("");
    try {
      const saved = await invoke<Application>(
        client,
        "practitioner-onboarding",
        {
          operation: "save",
          applicationId,
          expectedVersion: application.version,
          profile: payload,
        },
      );
      if (!alive.current) return;
      setApplication({ ...saved, ...notices(application) });
      setDirty(false);
      setComparison(null);
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
            termsVersion: application.current_terms_version,
            privacyVersion: application.current_privacy_version,
          },
        );
        if (!alive.current) return;
        setApplication({ ...row, ...notices(application) });
      }
      setMessage(
        submit
          ? "Profile submitted for review. Referral access begins only after approval."
          : "Draft saved.",
      );
    } catch (error) {
      if (!alive.current) return;
      setFailed(true);
      setMessage(errorText(error));
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function field<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }
  async function compare() {
    if (locked.current || !application) return;
    locked.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const row = await invoke<Application>(client, "practitioner-onboarding", {
        operation: "load",
        applicationId,
      });
      if (!alive.current) return;
      setComparison(row);
      setApplication((current) =>
        current ? { ...current, ...notices(row) } : current,
      );
      if (
        row.current_terms_version !== application.current_terms_version ||
        row.current_privacy_version !== application.current_privacy_version
      )
        setConsent(false);
      setMessage(
        "Saved version loaded below. Your form and its version are retained until you choose a new base.",
      );
    } catch (error) {
      if (alive.current) {
        setFailed(true);
        setMessage(errorText(error));
      }
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <WorkflowShell
      title="Your practitioner profile"
      step={3}
      recipient
      eyebrow="Professional details"
    >
      <p className="workflow-lead">
        Confirm your professional details and how you accept referrals. Your
        profile stays private until it has been reviewed and approved.
      </p>
      {message && application && (
        <p role={failed ? "alert" : "status"}>{message}</p>
      )}
      {!application ? (
        failed ? (
          <PageState
            kind="error"
            title="Your application could not be loaded"
            description={message}
            onRetry={() => {
              setFailed(false);
              setRetry((value) => value + 1);
            }}
          />
        ) : (
          <PageState kind="loading" title="Loading your application…" />
        )
      ) : (
        <>
          <p className="recipient-application-status">
            Status: <strong>{application.status.replaceAll("_", " ")}</strong>
          </p>
          {application.intendedIdentity && (
            <aside className="workflow-card" aria-label="Intended referral recipient">
              <h2>Who this referral is for</h2>
              <p>{application.intendedIdentity.displayName} · {application.intendedIdentity.practiceName}</p>
              <p>Complete your own professional details below. ReturnWell independently checks the intended person and practice before releasing patient information. Access to a shared clinic inbox alone is not approval.</p>
            </aside>
          )}
          {application.applicant_feedback && (
            <aside className="workflow-card">
              <h2>Review feedback</h2>
              <p>{application.applicant_feedback}</p>
            </aside>
          )}
          {application.status === "approved" && (
            <p>
              Your profile is approved.{" "}
              <a href="/practitioner">Open your practitioner workspace</a>. You
              can start a reviewed profile update from that workspace.
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
            ref={form}
            noValidate
            className="onboarding-form"
            onChange={() => {
              setDirty(true);
              setConfirmed(false);
            }}
            onSubmit={(event) => {
              event.preventDefault();
              void save(true);
            }}
          >
            <fieldset disabled={!editable || busy}>
              <legend>Profile details</legend>
              <h2>1. Professional identity</h2>
              <p>
                Save an incomplete draft at any time. Submission needs all
                required answers and an enabled professional review route.
              </p>
              {(
                [
                  ["displayName", "Full professional name", 160],
                  [
                    "registrationNumber",
                    getProfession(profile.profession || "")?.credentialLabel ??
                      "Professional credential",
                    40,
                  ],
                  ["practiceName", "Practice name", 200],
                ] as const
              ).map(([key, label, max]) => (
                <Field
                  key={key}
                  id={`profile-${key}`}
                  label={label}
                  error={issue(key)}
                >
                  {(props) => (
                    <input
                      {...props}
                      required
                      maxLength={max}
                      value={profile[key] || ""}
                      onChange={(event) => field(key, event.target.value)}
                    />
                  )}
                </Field>
              ))}
              <Field
                id="profile-profession"
                label="Profession"
                error={issue("profession")}
              >
                {(props) => (
                  <select
                    {...props}
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
                    {choices.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <p>
                A registration number is checked manually; entering it does not
                verify your identity.
              </p>
              <details open className="workflow-card">
                <summary>2. Services and referral preferences</summary>
                {([["services", "Services", true]] as const).map(
                  ([key, label, required]) => (
                    <Field
                      key={key}
                      id={`profile-${key}`}
                      label={`${label} (comma separated)`}
                      error={issue(key)}
                    >
                      {(props) => (
                        <input
                          {...props}
                          required={required}
                          value={listText[key]}
                          onChange={(event) =>
                            setListText((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))
                          }
                        />
                      )}
                    </Field>
                  ),
                )}
                <TermChecklist
                  kind="funding"
                  label="Funding pathways accepted"
                  values={split(listText.funding)}
                  error={issue("funding")}
                  onChange={(values) =>
                    setListText((current) => ({
                      ...current,
                      funding: values.join(", "),
                    }))
                  }
                />
                <TermChecklist
                  kind="language"
                  label="Languages offered"
                  values={split(listText.languages)}
                  error={issue("languages")}
                  onChange={(values) =>
                    setListText((current) => ({
                      ...current,
                      languages: values.join(", "),
                    }))
                  }
                />
                <p>
                  Confirm only capabilities you provide. Leaving these optional
                  requirements blank means your profile will not match referrals
                  that require them.
                </p>
                <TermChecklist
                  kind="service"
                  label="Confirmed service capabilities"
                  values={profile.serviceIds ?? []}
                  error={issue("serviceIds")}
                  onChange={(values) => field("serviceIds", values)}
                />
                <TermChecklist
                  kind="ageGroup"
                  label="Age groups you accept"
                  values={profile.ageGroupIds ?? []}
                  error={issue("ageGroupIds")}
                  onChange={(values) => field("ageGroupIds", values)}
                />
                {(
                  [
                    ["telehealth", "Do you provide telehealth?"],
                    [
                      "acceptingNewReferrals",
                      "Are you accepting new referrals?",
                    ],
                  ] as const
                ).map(([key, label]) => (
                  <Field
                    key={key}
                    id={`profile-${key}`}
                    label={label}
                    error={issue(key)}
                  >
                    {(props) => (
                      <select
                        {...props}
                        required
                        value={profile[key] == null ? "" : String(profile[key])}
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
                    )}
                  </Field>
                ))}
              </details>
              <details open className="workflow-card">
                <summary>3. Practice locations</summary>
                <p>
                  NSW locations only. A location is required if you do not offer
                  telehealth. Choose one primary location.
                </p>
                {issue("locations") && (
                  <p className="field-error">{issue("locations")}</p>
                )}
                {(profile.locations || []).map((location, index) => (
                  <div className="workflow-card" key={index}>
                    <Field
                      id={`location-${index}-suburb`}
                      label="Suburb"
                      error={issue(`locations.${index}.suburb`)}
                    >
                      {(props) => (
                        <input
                          {...props}
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
                      )}
                    </Field>
                    <Field
                      id={`location-${index}-postcode`}
                      label="Postcode"
                      error={issue(`locations.${index}.postcode`)}
                    >
                      {(props) => (
                        <input
                          {...props}
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
                      )}
                    </Field>
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
              </details>
              {editable && (
                <>
                  <h2>4. Review and confirm</h2>
                  {issue("profile") && (
                    <p className="field-error">{issue("profile")}</p>
                  )}
                  <label className="workflow-check">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => {
                        event.stopPropagation();
                        setConfirmed(event.target.checked);
                      }}
                    />
                    I confirm this profile is accurate.
                  </label>
                  <label className="workflow-check">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => {
                        event.stopPropagation();
                        setConsent(event.target.checked);
                      }}
                    />
                    <span>
                      I agree to receive referrals and accept the current{" "}
                      <a
                        href={application.current_terms_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        terms
                      </a>{" "}
                      and{" "}
                      <a
                        href={application.current_privacy_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        privacy policy
                      </a>
                      .
                    </span>
                  </label>
                  <details className="recipient-notice-versions">
                    <summary>Notice versions</summary>
                    <p>
                      Terms:{" "}
                      {application.current_terms_version || "unavailable"}
                      <br />
                      Privacy:{" "}
                      {application.current_privacy_version || "unavailable"}
                    </p>
                  </details>
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
                Loading does not overwrite your form. Compare the saved details
                before choosing which version your next save will replace.
              </p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void compare()}
              >
                Load saved version
              </button>
              {comparison && (
                <>
                  <h2>
                    Saved version {comparison.version} ·{" "}
                    {comparison.status.replaceAll("_", " ")}
                  </h2>
                  <ProfileSummary profile={comparison.profile} />
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setRebase(true)}
                  >
                    Use saved version as base
                  </button>
                </>
              )}
            </details>
          )}
        </>
      )}
      <ConfirmDialog
        open={rebase}
        title="Keep your form against this saved version?"
        description="Your current edits will be kept. Your next save will replace the version shown in the comparison. Check both carefully before continuing."
        confirmLabel="Keep my form"
        onCancel={() => setRebase(false)}
        onConfirm={() => {
          if (comparison) {
            setApplication(comparison);
            setConfirmed(false);
            setIssues([]);
            setMessage(
              "Your form is retained against the compared version. Review it before saving.",
            );
            setFailed(false);
          }
          setRebase(false);
        }}
      />
    </WorkflowShell>
  );
}
