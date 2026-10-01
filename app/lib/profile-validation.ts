import type { Application, Profile } from "./workflow.ts";
import { getProfession } from "./professions.ts";
import { normalizeTerm } from "./terminology.ts";
export type ProfessionPolicy = {
  professionId: string;
  enabled: boolean;
  scope: string;
  route: string;
  authorityId?: string;
};
export type FieldIssue = { field: string; code: string; message: string };
// Usability check only. Every save/submit still uses the authoritative SQL guard.
export function validateProfile(
  profile: Partial<Profile>,
  policies: ProfessionPolicy[],
  complete = true,
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const add = (field: string, message: string, code = "invalid") =>
    issues.push({ field, code, message });
  for (const [field, label, max] of [
    ["displayName", "your full professional name", 160],
    ["practiceName", "your practice name", 200],
    ["registrationNumber", "your professional credential number", 40],
  ] as const) {
    const value = profile[field];
    if (
      value !== undefined &&
      (typeof value !== "string" || value.length > max)
    )
      add(field, `Use ${max} characters or fewer for ${label}.`);
    else if (complete && !value?.trim())
      add(field, `Enter ${label}.`, "required");
  }
  const profession = profile.profession;
  const policy = policies.find((p) => p.professionId === profession);
  if (profession && !getProfession(profession))
    add("profession", "Choose a recognised profession.");
  else if (
    complete &&
    (!profession || !policy || policy.scope !== "supported" || !policy.enabled)
  )
    add(
      "profession",
      profession
        ? "This profession does not yet have an enabled review protocol. You can save a draft."
        : "Choose your profession.",
      "policy_required",
    );
  for (const field of ["telehealth", "acceptingNewReferrals"] as const) {
    if (
      (complete || profile[field] != null) &&
      typeof profile[field] !== "boolean"
    )
      add(
        field,
        "Choose Yes or No. An unanswered question is not a No.",
        "required",
      );
  }
  for (const field of [
    "services",
    "funding",
    "languages",
    "serviceIds",
    "ageGroupIds",
  ] as const) {
    const values = profile[field];
    const limit =
      field === "services" || field === "serviceIds" || field === "ageGroupIds"
        ? 30
        : 20;
    const max = field === "languages" ? 80 : 120;
    if (
      values !== undefined &&
      (!Array.isArray(values) ||
        values.length > limit ||
        values.some(
          (value) =>
            typeof value !== "string" || !value.trim() || value.length > max,
        ))
    ) {
      add(
        field,
        `Use up to ${limit} entries, each ${max} characters or fewer.`,
      );
      continue;
    }
    if (
      complete &&
      (field === "services" || field === "languages") &&
      !values?.length
    )
      add(
        field,
        `Choose at least one ${field === "services" ? "service" : "language"}.`,
        "required",
      );
    const kind =
      field === "funding"
        ? "funding"
        : field === "languages"
          ? "language"
          : field === "serviceIds"
            ? "service"
            : field === "ageGroupIds"
              ? "ageGroup"
              : null;
    if (
      kind &&
      (complete || field === "serviceIds" || field === "ageGroupIds") &&
      values?.some((value) => !normalizeTerm(kind, value))
    )
      add(
        field,
        "Resolve the unclear entries using the listed choices.",
        "unknown_term",
      );
  }
  const locations = profile.locations;
  if (
    locations !== undefined &&
    (!Array.isArray(locations) || locations.length > 10)
  )
    add("locations", "Use up to 10 practice locations.");
  else if (locations) {
    for (const [index, location] of locations.entries()) {
      if (!location || typeof location !== "object") {
        add("locations", "Check each practice location.");
        continue;
      }
      if (
        complete &&
        (typeof location.suburb !== "string" ||
          !location.suburb.trim() ||
          location.suburb.length > 120)
      )
        add(
          `locations.${index}.suburb`,
          "Enter the practice suburb (up to 120 characters).",
        );
      if (complete && !/^[0-9]{4}$/.test(location.postcode ?? ""))
        add(`locations.${index}.postcode`, "Enter a four-digit postcode.");
      if (complete && location.state !== "NSW")
        add("locations", "This pilot supports NSW practice locations.");
    }
    if (
      complete &&
      locations.length &&
      locations.filter((location) => location?.isPrimary === true).length !== 1
    )
      add("locations", "Choose exactly one primary location.");
  }
  if (complete && profile.telehealth === false && !locations?.length)
    add(
      "locations",
      "Add a practice location when telehealth is not offered.",
      "required",
    );
  if (new TextEncoder().encode(JSON.stringify(profile)).length > 14000)
    add("profile", "Shorten the profile before saving.", "too_large");
  return issues;
}
export function canConfirmProfile(
  application: Pick<
    Application,
    "current_terms_version" | "current_privacy_version"
  >,
  confirmation: {
    profileConfirmed?: boolean;
    referralConsent?: boolean;
    termsVersion?: string;
    privacyVersion?: string;
  },
) {
  return Boolean(
    application.current_terms_version &&
    application.current_privacy_version &&
    confirmation.profileConfirmed === true &&
    confirmation.referralConsent === true &&
    confirmation.termsVersion === application.current_terms_version &&
    confirmation.privacyVersion === application.current_privacy_version,
  );
}
