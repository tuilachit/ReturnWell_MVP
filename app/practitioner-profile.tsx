"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { invoke } from "./lib/workflow";
import { professionLabel } from "./lib/professions";
import { normalizeTerm } from "./lib/terminology";
import type { CredentialSummary } from "./lib/credentials";
import ConfirmDialog from "./components/confirm-dialog";
import { startProfileRevision } from "./lib/profile-revisions";

type ApprovedProfile = {
  display_name: string;
  profession: string;
  practice_name: string;
  services: string[];
  funding: string[];
  languages: string[];
  telehealth: boolean;
  service_ids: string[];
  age_group_ids: string[];
};
type Location = {
  suburb: string;
  postcode: string;
  state: string;
  is_primary: boolean;
};

export default function PractitionerProfile({
  client,
  practitionerId,
  refreshKey = 0,
}: {
  client: SupabaseClient;
  practitionerId: string;
  refreshKey?: number;
}) {
  const [profile, setProfile] = useState<ApprovedProfile | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [credentials, setCredentials] = useState<{
    eligibleForNewReferral: boolean;
    credentials: CredentialSummary[];
  } | null>(null);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [starting, setStarting] = useState(false);
  const pending = useRef<string | null>(null);
  const running = useRef(false);
  useEffect(() => {
    let active = true;
    void Promise.all([
      client
        .from("practitioners")
        .select(
          "display_name,profession,practice_name,services,funding,languages,telehealth,service_ids,age_group_ids",
        )
        .eq("id", practitionerId)
        .maybeSingle(),
      client
        .from("practitioner_locations")
        .select("suburb,postcode,state,is_primary")
        .eq("practitioner_id", practitionerId),
      invoke<{
        eligibleForNewReferral: boolean;
        credentials: CredentialSummary[];
      }>(client, "practitioner-onboarding", {
        operation: "credentials",
        practitionerId,
      }),
    ])
      .then(([person, places, credentialResult]) => {
        if (!active) return;
        if (person.error || places.error || !person.data) {
          setMessage("Your approved profile is unavailable.");
          return;
        }
        setProfile(person.data as ApprovedProfile);
        setLocations(places.data || []);
        setCredentials(credentialResult);
      })
      .catch(() => {
        if (active)
          setMessage(
            "Your approved profile is unavailable. Try again after checking your workspace access.",
          );
      });
    return () => {
      active = false;
    };
  }, [client, practitionerId, refreshKey]);
  async function beginRevision() {
    if (running.current) return;
    running.current = true;
    setStarting(true);
    setMessage("");
    pending.current ??= crypto.randomUUID();
    try {
      await startProfileRevision(client, {
        practitionerId,
        requestId: pending.current,
      });
      window.location.assign("/onboarding");
    } catch {
      setMessage(
        "The update draft could not be confirmed. Try again to recover the same request.",
      );
    } finally {
      running.current = false;
      setStarting(false);
    }
  }
  return (
    <details className="workflow-card">
      <summary>Your approved profile</summary>
      {message ? (
        <p role="status">{message}</p>
      ) : profile ? (
        <dl>
          <div>
            <dt>Professional name</dt>
            <dd>{profile.display_name}</dd>
          </div>
          <div>
            <dt>Profession</dt>
            <dd>{professionLabel(profile.profession)}</dd>
          </div>
          <div>
            <dt>New referral eligibility</dt>
            <dd>
              {credentials?.eligibleForNewReferral
                ? "Eligible, subject to referral requirements"
                : "Not currently eligible — check intake and credential review"}
            </dd>
          </div>
          {credentials?.credentials.map((credential) => (
            <div key={credential.professionId}>
              <dt>
                {professionLabel(credential.professionId)} credential review
              </dt>
              <dd>
                {credential.reviewDueAt
                  ? `Review due ${new Date(credential.reviewDueAt).toLocaleDateString("en-AU")}`
                  : "Review deadline requires reconfirmation"}
                {credential.expiresAt
                  ? ` · Expires ${new Date(credential.expiresAt).toLocaleDateString("en-AU")}`
                  : ""}
              </dd>
            </div>
          ))}
          <div>
            <dt>Practice</dt>
            <dd>{profile.practice_name}</dd>
          </div>
          <div>
            <dt>Services</dt>
            <dd>{profile.services.join(", ")}</dd>
          </div>
          <div>
            <dt>Funding</dt>
            <dd>
              {profile.funding
                .map(
                  (v) =>
                    normalizeTerm("funding", v)?.label ??
                    `${v} (needs clarification)`,
                )
                .join(", ") || "None listed"}
            </dd>
          </div>
          <div>
            <dt>Languages</dt>
            <dd>
              {profile.languages
                .map((v) => normalizeTerm("language", v)?.label ?? v)
                .join(", ")}
            </dd>
          </div>
          <div>
            <dt>Confirmed service capabilities</dt>
            <dd>
              {profile.service_ids
                .map((v) => normalizeTerm("service", v)?.label ?? v)
                .join(", ") || "Not confirmed"}
            </dd>
          </div>
          <div>
            <dt>Age groups accepted</dt>
            <dd>
              {profile.age_group_ids
                .map((v) => normalizeTerm("ageGroup", v)?.label ?? v)
                .join(", ") || "Not confirmed"}
            </dd>
          </div>
          <div>
            <dt>Telehealth</dt>
            <dd>{profile.telehealth ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt>Locations</dt>
            <dd>
              {locations.length
                ? locations
                    .map(
                      (location) =>
                        `${location.suburb}, ${location.state} ${location.postcode}${location.is_primary ? " (primary)" : ""}`,
                    )
                    .join("; ")
                : "None listed"}
            </dd>
          </div>
        </dl>
      ) : (
        <p>Loading profile…</p>
      )}
      <p>
        Proposed changes are reviewed before they replace this profile. Starting
        an update pauses new matching; existing referrals remain available.
      </p>
      <button
        type="button"
        className="button secondary"
        onClick={() => setEditing(true)}
      >
        Update reviewed profile
      </button>
      <ConfirmDialog
        open={editing}
        title="Update your approved profile?"
        description="A private editable copy will be created. New matching pauses until independent review. Your last approved profile and existing referrals remain available."
        confirmLabel="Start profile update"
        busy={starting}
        onCancel={() => setEditing(false)}
        onConfirm={() => void beginRevision()}
      />
    </details>
  );
}
