import type { AppointmentFormat, Practitioner, Profession } from "../types";
import { isEligibleForNewReferral } from "./credentials.ts";

export type MatchNeeds = {
  profession: Profession;
  appointmentFormat: AppointmentFormat;
  fundingPath: string;
  language?: string;
};

export type MatchedPractitioner = {
  practitioner: Practitioner;
  reasons: string[];
};

const includesIgnoreCase = (values: string[], wanted: string) => {
  const normalized = wanted.trim().toLocaleLowerCase("en-AU");
  return values.some(
    (value) => value.trim().toLocaleLowerCase("en-AU") === normalized,
  );
};

export function matchPractitioners(
  practitioners: Practitioner[],
  needs: MatchNeeds,
): MatchedPractitioner[] {
  const language = needs.language?.trim() ?? "";

  return practitioners
    .filter((practitioner) => {
      if (
        !isEligibleForNewReferral(practitioner, needs.profession) ||
        practitioner.profession !== needs.profession
      )
        return false;

      if (needs.appointmentFormat === "telehealth" && !practitioner.telehealth)
        return false;
      if (needs.appointmentFormat === "in_person" && !practitioner.location)
        return false;
      if (!includesIgnoreCase(practitioner.funding, needs.fundingPath))
        return false;
      if (language && !includesIgnoreCase(practitioner.languages, language))
        return false;
      return true;
    })
    .map((practitioner) => {
      const reasons = [
        "Registration verified",
        "Provider details confirmed",
        "Accepting new referrals",
      ];
      if (needs.appointmentFormat === "telehealth")
        reasons.push("Offers telehealth");
      reasons.push(`Supports ${needs.fundingPath}`);
      if (language) reasons.push(`Speaks ${language}`);
      if (practitioner.distanceKm !== null) {
        reasons.push(
          `${practitioner.distanceKm.toFixed(1)} km from the patient postcode`,
        );
      }
      return { practitioner, reasons };
    })
    .sort((left, right) => {
      const leftDistance =
        left.practitioner.distanceKm ?? Number.POSITIVE_INFINITY;
      const rightDistance =
        right.practitioner.distanceKm ?? Number.POSITIVE_INFINITY;
      return (
        leftDistance - rightDistance ||
        left.practitioner.displayName.localeCompare(
          right.practitioner.displayName,
          "en-AU",
        ) ||
        left.practitioner.id.localeCompare(right.practitioner.id)
      );
    });
}
