import type { Practitioner, Referral } from "../types";
import type { CredentialSummary } from "../lib/credentials";
// Fictional preview only. These records are never imported to the backend.
const demoCredential = (
  professionId: string,
  authorityId: string,
): CredentialSummary[] => [
  {
    professionId,
    authorityId,
    route: "ahpra",
    status: "verified",
    policyEnabled: true,
    checkedAt: "2026-09-01T00:00:00Z",
    expiresAt: null,
    reviewDueAt: "2099-01-01T00:00:00Z",
  },
];

export const demoReferrals: Referral[] = [
  {
    id: "00000000-0000-4000-8000-000000000101",
    reference: "DEMO-REF-101",
    patientReference: "DEMO-PAT-01",
    patientPostcode: "2000",
    profession: "physiotherapist",
    clinicalSummary: "Example mobility assessment request.",
    fundingPath: "Medicare",
    appointmentFormat: "either",
    languageOrAccess: "",
    selectionMode: "doctor",
    selectedPractitionerId: "00000000-0000-4000-8000-000000000201",
    providerName: "Demo Movement Practice",
    status: "accepted",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  },
];

export const demoPractitioners: Practitioner[] = [
  {
    id: "00000000-0000-4000-8000-000000000201",
    displayName: "Taylor Example",
    credentials: demoCredential("physiotherapist", "ahpra_physiotherapy"),
    practiceName: "Demo Movement Practice",
    profession: "physiotherapist",
    lifecycleStatus: "active",
    ahpraVerificationStatus: "verified",
    providerConfirmationStatus: "confirmed",
    acceptingNewReferrals: true,
    telehealth: true,
    funding: ["Medicare", "Self funded"],
    languages: ["English"],
    services: ["Mobility", "Persistent pain"],
    serviceIds: ["persistent_pain"],
    ageGroupIds: ["adult", "older_adult"],
    location: { suburb: "Sydney", postcode: "2000" },
    distanceKm: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000202",
    displayName: "Jordan Example",
    credentials: demoCredential("psychologist", "ahpra_psychology"),
    practiceName: "Demo Psychology Practice",
    profession: "psychologist",
    lifecycleStatus: "active",
    ahpraVerificationStatus: "verified",
    providerConfirmationStatus: "confirmed",
    acceptingNewReferrals: true,
    telehealth: true,
    funding: ["Medicare", "Self funded"],
    languages: ["English", "Mandarin"],
    services: ["Anxiety", "Adjustment support"],
    serviceIds: [],
    ageGroupIds: ["adolescent", "adult", "older_adult"],
    location: { suburb: "Sydney", postcode: "2000" },
    distanceKm: null,
  },
];
