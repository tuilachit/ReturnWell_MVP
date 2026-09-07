export type Profession = "physiotherapist" | "psychologist";
export type AppointmentFormat = "either" | "in_person" | "telehealth";
export type SelectionMode = "doctor" | "patient";

export type Workspace = {
  organisationId: string;
  organisationName: string;
  displayName: string;
};

export type Referral = {
  id: string;
  reference: string;
  patientReference: string;
  patientPostcode: string;
  profession: Profession;
  clinicalSummary: string;
  fundingPath: string;
  appointmentFormat: AppointmentFormat;
  languageOrAccess: string;
  selectionMode: SelectionMode;
  selectedPractitionerId: string | null;
  providerName: string;
  status: "sent" | "accepted" | "declined" | "booked" | "cancelled";
  createdAt: string;
  updatedAt: string;
};

export type Practitioner = {
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
  patientReference: string;
  patientPostcode: string;
  profession: Profession;
  clinicalSummary: string;
  fundingPath: string;
  appointmentFormat: AppointmentFormat;
  languageOrAccess: string;
  selectionMode: SelectionMode;
  selectedPractitionerId: string | null;
  consentConfirmed: boolean;
};
