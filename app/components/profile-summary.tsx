import type { Profile } from "../lib/workflow";
import { getProfession } from "../lib/professions";
import { normalizeTerm } from "../lib/terminology";

export default function ProfileSummary({
  profile,
}: {
  profile: Partial<Profile>;
}) {
  const choice = (value: boolean | undefined) =>
    value == null ? "Not answered" : value ? "Yes" : "No";
  const terms = (
    kind: "funding" | "language" | "service" | "ageGroup",
    values?: string[],
  ) =>
    values
      ?.map((value) => normalizeTerm(kind, value)?.label ?? value)
      .join(", ");
  const rows = [
    ["Professional name", profile.displayName],
    ["Practice name", profile.practiceName],
    ["Profession", getProfession(profile.profession ?? "")?.label],
    [
      getProfession(profile.profession ?? "")?.credentialLabel ??
        "Professional credential",
      profile.registrationNumber,
    ],
    ["Services", profile.services?.join(", ")],
    ["Funding", terms("funding", profile.funding)],
    ["Languages", terms("language", profile.languages)],
    ["Confirmed capabilities", terms("service", profile.serviceIds)],
    ["Age groups", terms("ageGroup", profile.ageGroupIds)],
    ["Telehealth", choice(profile.telehealth)],
    ["Accepting referrals", choice(profile.acceptingNewReferrals)],
    [
      "Practice locations",
      profile.locations
        ?.map(
          (location) =>
            `${location.suburb}, ${location.state} ${location.postcode}${location.isPrimary ? " (primary)" : ""}`,
        )
        .join("; "),
    ],
  ];
  return (
    <dl className="profile-summary">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value || "Not provided"}</dd>
        </div>
      ))}
    </dl>
  );
}
