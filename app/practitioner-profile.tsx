"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

type ApprovedProfile = {
  display_name: string;
  profession: string;
  practice_name: string;
  ahpra_registration_number: string;
  services: string[];
  funding: string[];
  languages: string[];
  telehealth: boolean;
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
}: {
  client: SupabaseClient;
  practitionerId: string;
}) {
  const [profile, setProfile] = useState<ApprovedProfile | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.all([
      client
        .from("practitioners")
        .select(
          "display_name,profession,practice_name,ahpra_registration_number,services,funding,languages,telehealth",
        )
        .eq("id", practitionerId)
        .maybeSingle(),
      client
        .from("practitioner_locations")
        .select("suburb,postcode,state,is_primary")
        .eq("practitioner_id", practitionerId),
    ]).then(([person, places]) => {
      if (!active) return;
      if (person.error || places.error || !person.data) {
        setMessage("Your approved profile is unavailable.");
        return;
      }
      setProfile(person.data as ApprovedProfile);
      setLocations(places.data || []);
    });
    return () => {
      active = false;
    };
  }, [client, practitionerId]);
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
            <dt>Profession and registration</dt>
            <dd>
              {profile.profession} · {profile.ahpra_registration_number}
            </dd>
          </div>
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
            <dd>{profile.funding.join(", ") || "None listed"}</dd>
          </div>
          <div>
            <dt>Languages</dt>
            <dd>{profile.languages.join(", ")}</dd>
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
        To change your identity, registration or other reviewed profile
        information, contact ReturnWell through the support details in your
        invitation.
      </p>
    </details>
  );
}
