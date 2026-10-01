// IDs are validated against the shared catalogue; unknown historical values are
// displayed explicitly rather than silently relabelled as psychology.
export type Profession = string;
export type AppointmentFormat = "either" | "in_person" | "telehealth";
export type SelectionMode = "doctor" | "patient";

export type Workspace = {
  organisationId: string;
  organisationName: string;
  displayName: string;
};

export type Referral = {
  requiredServiceIds?: string[];
  patientAgeGroupId?: string;
  id: string;
  reference: string;
  version?: number;
  supersedesReferralId?: string | null;
  patientReference: string;
  patientPostcode: string;
  profession: Profession;
  clinicalSummary: string;
  fundingPath: string;
  appointmentFormat: AppointmentFormat;
  languageOrAccess: string;
  preferredLanguage?: string;
  accessNotes?: string;
  selectionMode: SelectionMode;
  selectedPractitionerId: string | null;
  providerName: string;
  status:
    | "awaiting_onboarding"
    | "sent"
    | "accepted"
    | "declined"
    | "booked"
    | "cancelled"
    | "closed";
  createdAt: string;
  updatedAt: string;
};

export type Practitioner = {
  credentials?: import("./lib/credentials").CredentialSummary[];
  accessSuspended?: boolean;
  profileRevisionPending?: boolean;
  serviceIds?: string[];
  ageGroupIds?: string[];
  locationPrecision?: string | null;
  id: string;
  displayName: string;
  practiceName: string;
  profession: Profession;
  lifecycleStatus: "candidate" | "active" | "inactive";
  ahpraVerificationStatus: "not_checked" | "verified" | "failed";
  providerConfirmationStatus: "not_contacted" | "confirmed" | "declined";
  acceptingNewReferrals: boolean;
  telehealth: boolean;
  funding: string[];
  languages: string[];
  services: string[];
  location: { suburb: string; postcode: string } | null;
  distanceKm: number | null;
};

export type ReferralInput = {
  requiredServiceIds?: string[];
  patientAgeGroupId?: string;
  patientReference: string;
  patientPostcode: string;
  profession: Profession;
  clinicalSummary: string;
  fundingPath: string;
  appointmentFormat: AppointmentFormat;
  languageOrAccess: string;
  preferredLanguage?: string;
  accessNotes?: string;
  selectionMode: SelectionMode;
  selectedPractitionerId: string | null;
  consentConfirmed: boolean;
};
