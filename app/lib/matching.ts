import type { AppointmentFormat, Practitioner } from "../types";
import { isEligibleForNewReferral } from "./credentials.ts";
import { normalizeTerm } from "./terminology.ts";

export type MatchNeeds = {
  professionId: string;
  appointmentFormat: AppointmentFormat;
  fundingId: string;
  preferredLanguageId?: string;
  requiredServiceIds: string[];
  patientAgeGroupId?: string;
};
export type LegacyMatchNeeds = {
  profession: string;
  appointmentFormat: AppointmentFormat;
  fundingPath: string;
  language?: string;
  requiredServiceIds?: string[];
  patientAgeGroupId?: string;
};
export type MatchResult = {
  practitioner: Practitioner;
  reasons: string[];
  warnings: string[];
  distanceKm: number | null;
  locationPrecision: string | null;
};
export type MatchedPractitioner = MatchResult;

// Match PostgreSQL's C collation after ASCII case-folding, independent of the
// browser's locale/ICU version. Compare codepoints, including non-BMP names.
function compareName(a: string, b: string): number {
  const fold = (s: string) =>
    Array.from(
      s.replace(/[A-Z]/g, (c) => c.toLowerCase()),
      (c) => c.codePointAt(0)!,
    );
  const left = fold(a),
    right = fold(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

// Only known catalogue aliases are adapted. Old mixed language/access notes
// are deliberately not a field here, and unknown funding cannot pass a match.
export function normaliseMatchNeeds(
  input: MatchNeeds | LegacyMatchNeeds,
): MatchNeeds | null {
  const needs =
    "professionId" in input
      ? input
      : {
          professionId: input.profession,
          appointmentFormat: input.appointmentFormat,
          fundingId: input.fundingPath,
          preferredLanguageId: input.language,
          requiredServiceIds: input.requiredServiceIds ?? [],
          patientAgeGroupId: input.patientAgeGroupId,
        };
  const funding = normalizeTerm("funding", needs.fundingId);
  const language = needs.preferredLanguageId?.trim()
    ? normalizeTerm("language", needs.preferredLanguageId)
    : null;
  const age = needs.patientAgeGroupId?.trim()
    ? normalizeTerm("ageGroup", needs.patientAgeGroupId)
    : null;
  const services = needs.requiredServiceIds.map((id) =>
    normalizeTerm("service", id),
  );
  if (
    !funding ||
    (needs.preferredLanguageId?.trim() && !language) ||
    (needs.patientAgeGroupId?.trim() && !age) ||
    services.some((x) => !x)
  )
    return null;
  if (!["in_person", "telehealth", "either"].includes(needs.appointmentFormat))
    return null;
  return {
    ...needs,
    fundingId: funding.id,
    preferredLanguageId: language?.id,
    requiredServiceIds: [...new Set(services.map((x) => x!.id))].sort(),
    patientAgeGroupId: age?.id,
  };
}

export function matchPractitioners(
  practitioners: Practitioner[],
  input: MatchNeeds | LegacyMatchNeeds,
): MatchResult[] {
  const needs = normaliseMatchNeeds(input);
  if (!needs) return [];
  return practitioners
    .filter(
      (p) =>
        isEligibleForNewReferral(p, needs.professionId) &&
        p.profession === needs.professionId &&
        (needs.appointmentFormat !== "telehealth" || p.telehealth) &&
        (needs.appointmentFormat !== "in_person" || p.location !== null) &&
        (needs.appointmentFormat !== "either" ||
          p.telehealth ||
          p.location !== null) &&
        p.funding.some(
          (f) => normalizeTerm("funding", f)?.id === needs.fundingId,
        ) &&
        (!needs.preferredLanguageId ||
          p.languages.some(
            (l) =>
              normalizeTerm("language", l)?.id === needs.preferredLanguageId,
          )) &&
        needs.requiredServiceIds.every((id) => p.serviceIds?.includes(id)) &&
        (!needs.patientAgeGroupId ||
          p.ageGroupIds?.includes(needs.patientAgeGroupId)),
    )
    .map((p) => {
      const distanceKm =
        needs.appointmentFormat === "telehealth" || !p.location
          ? null
          : p.distanceKm;
      const reasons = [
        "Registration verified",
        "Provider details confirmed",
        "Accepting new referrals",
      ];
      if (needs.appointmentFormat === "telehealth")
        reasons.push("Offers telehealth");
      reasons.push(
        "Funding pathway reported: " +
          normalizeTerm("funding", needs.fundingId)!.label,
      );
      if (needs.preferredLanguageId)
        reasons.push(
          "Speaks " +
            normalizeTerm("language", needs.preferredLanguageId)!.label,
        );
      for (const id of needs.requiredServiceIds)
        reasons.push("Service: " + normalizeTerm("service", id)!.label);
      if (needs.patientAgeGroupId)
        reasons.push(
          "Age group: " +
            normalizeTerm("ageGroup", needs.patientAgeGroupId)!.label,
        );
      if (distanceKm !== null)
        reasons.push(
          "Approx. " + distanceKm.toFixed(1) + " km between postcode areas",
        );
      const warnings = [
        "Confirm fees and rebate eligibility with the practitioner.",
      ];
      if (
        needs.appointmentFormat !== "telehealth" &&
        p.location &&
        distanceKm === null
      )
        warnings.push("Distance unavailable; browse by suburb.");
      return {
        practitioner: p,
        reasons,
        warnings,
        distanceKm,
        locationPrecision:
          distanceKm === null ? null : (p.locationPrecision ?? null),
      };
    })
    .sort(
      (a, b) =>
        (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) ||
        compareName(a.practitioner.displayName, b.practitioner.displayName) ||
        compareName(a.practitioner.id, b.practitioner.id),
    );
}
