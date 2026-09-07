import assert from "node:assert/strict";
import test from "node:test";

import { validateReferralInput } from "../app/lib/referrals.ts";

const validInput = {
  patientReference: "PAT-104",
  patientPostcode: "2017",
  profession: "physiotherapist",
  clinicalSummary: "Persistent back pain requiring assessment.",
  fundingPath: "Medicare",
  appointmentFormat: "either",
  languageOrAccess: "",
  selectionMode: "doctor",
  selectedPractitionerId: "00000000-0000-4000-8000-000000000001",
  consentConfirmed: true,
};

test("accepts a complete referral", () => {
  assert.deepEqual(validateReferralInput(validInput), []);
});

test("rejects blank identifiers, invalid postcodes and missing consent", () => {
  const errors = validateReferralInput({
    ...validInput,
    patientReference: " ",
    patientPostcode: "ABC",
    consentConfirmed: false,
  });

  assert.deepEqual(errors, [
    "Enter the patient reference used by your practice.",
    "Enter a valid four-digit Australian postcode.",
    "Confirm the patient has consented before sending.",
  ]);
});

test("requires a selected practitioner only when the doctor is choosing", () => {
  assert.deepEqual(
    validateReferralInput({ ...validInput, selectedPractitionerId: null }),
    ["Select a practitioner or let the patient choose."],
  );
  assert.deepEqual(
    validateReferralInput({ ...validInput, selectionMode: "patient", selectedPractitionerId: null }),
    [],
  );
});
