import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReferralInput } from "../types";
import { invoke } from "./workflow.ts";
import { isSupportedProfession } from "./professions.ts";
import { normalizeTerm } from "./terminology.ts";
export type DraftInput = Partial<
  Omit<ReferralInput, "selectionMode" | "consentConfirmed">
> & { preferredLanguage?: string; accessNotes?: string; patientLocalityId?: string; searchRadiusKm?: number };
export type ReferralDraft = {
  id: string;
  organisationId: string;
  createdBy: string;
  version: number;
  input: DraftInput;
  updatedAt: string;
  finalizedReferralId: string | null;
  supersedesReferralId?: string | null;
};
export type DraftSummary = {
  id: string;
  patientReference: string | null;
  version: number;
  updatedAt: string;
};
export function validateDraft(input: DraftInput): string[] {
  const limits: Record<string, number> = {
    patientReference: 120,
    patientPostcode: 4,
    profession: 120,
    clinicalSummary: 4000,
    fundingPath: 120,
    appointmentFormat: 120,
    languageOrAccess: 240,
    preferredLanguage: 120,
    accessNotes: 500,
    selectedPractitionerId: 36,
    patientAgeGroupId: 120,
    patientLocalityId: 200,
  };
  const errors: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (key === "searchRadiusKm") {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 500 || !input.patientLocalityId)
        errors.push("Choose a suburb before a radius between 1 and 500 km.");
      continue;
    }
    if (key === "requiredServiceIds") {
      if (
        !Array.isArray(value) ||
        value.length > 30 ||
        value.some(
          (id) => typeof id !== "string" || !normalizeTerm("service", id),
        )
      )
        errors.push("Choose supported services.");
      continue;
    }
    if (key === "selectedPractitionerId" && value === null) continue;
    if (
      !(key in limits) ||
      typeof value !== "string" ||
      value.length > limits[key]
    )
      errors.push(`Check ${key}.`);
  }
  if (
    input.patientPostcode &&
    !/^[0-9]{4}$/.test(String(input.patientPostcode))
  )
    errors.push("Enter a four-digit postcode or leave it blank.");
  if (input.patientLocalityId && (!input.patientPostcode || !input.patientLocalityId.startsWith(`NSW:${input.patientPostcode}:`) || !input.patientLocalityId.split(":")[2]))
    errors.push("Choose a suburb within the patient postcode.");
  if (input.profession && !isSupportedProfession(input.profession))
    errors.push("Choose a supported profession.");
  if (
    input.appointmentFormat &&
    !["either", "in_person", "telehealth"].includes(input.appointmentFormat)
  )
    errors.push("Choose an appointment format.");
  if (
    input.patientAgeGroupId &&
    !normalizeTerm("ageGroup", input.patientAgeGroupId)
  )
    errors.push("Choose a supported age group.");
  return errors;
}
export function saveReferralDraft(
  client: SupabaseClient,
  input: {
    id: string;
    organisationId: string;
    expectedVersion: number;
    input: DraftInput;
    requestId: string;
  },
) {
  const issues = validateDraft(input.input);
  if (issues.length) return Promise.reject(new Error(issues[0]));
  return invoke<ReferralDraft>(client, "manage-referral", {
    operation: "draft.save",
    ...input,
  });
}
export const loadReferralDraft = (client: SupabaseClient, id: string) =>
  invoke<ReferralDraft>(client, "manage-referral", {
    operation: "draft.load",
    id,
  });
export const listReferralDrafts = (
  client: SupabaseClient,
  organisationId: string,
) =>
  invoke<{ drafts: DraftSummary[] }>(client, "manage-referral", {
    operation: "draft.list",
    organisationId,
  });
export const finalizeReferralDraft = (
  client: SupabaseClient,
  input: {
    id: string;
    expectedVersion: number;
    consentConfirmed: true;
    requestId: string;
  },
) =>
  invoke<Record<string, unknown>>(client, "manage-referral", {
    operation: "draft.finalize",
    ...input,
  });
