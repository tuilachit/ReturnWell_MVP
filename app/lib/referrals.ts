import type { SupabaseClient } from "@supabase/supabase-js";
import type { Practitioner, Referral, ReferralInput, Workspace } from "../types";

type ReferralRow = {
  id: string;
  reference: string;
  patient_reference: string;
  patient_postcode: string;
  profession: Referral["profession"];
  clinical_summary: string;
  funding_path: string;
  appointment_format: Referral["appointmentFormat"];
  language_or_access: string | null;
  selection_mode: Referral["selectionMode"];
  selected_practitioner_id: string | null;
  status: Referral["status"];
  created_at: string;
  updated_at: string;
  practitioners?: { practice_name?: string } | null;
};

const rowToReferral = (row: ReferralRow): Referral => ({
  id: row.id,
  reference: row.reference,
  patientReference: row.patient_reference,
  patientPostcode: row.patient_postcode,
  profession: row.profession,
  clinicalSummary: row.clinical_summary,
  fundingPath: row.funding_path,
  appointmentFormat: row.appointment_format,
  languageOrAccess: row.language_or_access ?? "",
  selectionMode: row.selection_mode,
  selectedPractitionerId: row.selected_practitioner_id,
  providerName: row.practitioners?.practice_name ?? (row.selected_practitioner_id ? "Assigned practitioner — profile unavailable" : row.selection_mode === "patient" ? "Patient choosing" : "Not assigned"),
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function validateReferralInput(input: ReferralInput): string[] {
  const errors: string[] = [];
  if (!input.patientReference.trim()) errors.push("Enter the patient reference used by your practice.");
  if (!/^\d{4}$/.test(input.patientPostcode)) errors.push("Enter a valid four-digit Australian postcode.");
  if (!input.clinicalSummary.trim()) errors.push("Describe the reason for referral.");
  if (!input.consentConfirmed) errors.push("Confirm the patient has consented before sending.");
  if (input.selectionMode === "doctor" && !input.selectedPractitionerId) {
    errors.push("Select a practitioner or let the patient choose.");
  }
  return errors;
}

export async function loadWorkspace(
  client: SupabaseClient,
  userId: string,
): Promise<Workspace | null> {
  const [{ data: membership, error: membershipError }, { data: profile, error: profileError }] = await Promise.all([
    client.from("organisation_memberships").select("organisation_id, organisations(name)").eq("user_id", userId).eq("active", true).limit(1).maybeSingle(),
    client.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
  ]);
  if (membershipError) throw membershipError;
  if (profileError) throw profileError;
  if (!membership) return null;

  const organisation = membership.organisations as unknown as { name: string } | null;
  return {
    organisationId: membership.organisation_id,
    organisationName: organisation?.name ?? "Referral workspace",
    displayName: profile?.display_name ?? "Signed-in user",
  };
}

export async function listReferrals(client: SupabaseClient, organisationId: string): Promise<Referral[]> {
  const { data, error } = await client
    .from("referrals")
    .select("*, practitioners:practitioners!referrals_selected_practitioner_id_fkey(practice_name)")
    .eq("organisation_id", organisationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as ReferralRow[]).map(rowToReferral);
}

export async function listPractitioners(client: SupabaseClient): Promise<Practitioner[]> {
  const { data, error } = await client.from("verified_practitioners").select("*").order("display_name");
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const { data: locations, error: locationError } = await client
    .from("practitioner_locations")
    .select("practitioner_id, suburb, postcode")
    .in("practitioner_id", ids)
    .eq("is_primary", true);
  if (locationError) throw locationError;

  const locationByPractitioner = new Map((locations ?? []).map((location) => [location.practitioner_id, location]));
  return rows.map((row) => {
    const location = locationByPractitioner.get(row.id);
    return {
      id: row.id,
      displayName: row.display_name,
      practiceName: row.practice_name,
      profession: row.profession,
      lifecycleStatus: "active",
      ahpraVerificationStatus: "verified",
      providerConfirmationStatus: "confirmed",
      acceptingNewReferrals: true,
      telehealth: Boolean(row.telehealth),
      funding: row.funding ?? [],
      languages: row.languages ?? [],
      services: row.services ?? [],
      location: location ? { suburb: location.suburb, postcode: location.postcode } : null,
      distanceKm: null,
    } satisfies Practitioner;
  });
}

export async function createReferral(
  client: SupabaseClient,
  workspace: Workspace,
  userId: string,
  input: ReferralInput,
): Promise<Referral> {
  const errors = validateReferralInput(input);
  if (errors.length > 0) throw new Error(errors.join(" "));

  const reference = `RW-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const { data, error } = await client.from("referrals").insert({
    reference,
    organisation_id: workspace.organisationId,
    created_by: userId,
    patient_reference: input.patientReference.trim(),
    patient_postcode: input.patientPostcode,
    profession: input.profession,
    clinical_summary: input.clinicalSummary.trim(),
    funding_path: input.fundingPath,
    appointment_format: input.appointmentFormat,
    language_or_access: input.languageOrAccess.trim() || null,
    selection_mode: input.selectionMode,
    selected_practitioner_id: input.selectedPractitionerId,
    consent_confirmed_at: new Date().toISOString(),
  }).select("*").single();
  if (error) throw error;
  return rowToReferral(data as ReferralRow);
}
