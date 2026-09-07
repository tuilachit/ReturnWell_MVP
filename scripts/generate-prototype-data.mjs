import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const sourceUrl = new URL(
  "../../private-data/sydney-master/target-200-ahpra-review.json",
  import.meta.url,
);
const uiOutputUrl = new URL("../app/data/practitioners.generated.json", import.meta.url);
const importOutputUrl = new URL("../public/returnwell-import-bundle.json", import.meta.url);

const sourceRecords = JSON.parse(await readFile(sourceUrl, "utf8"));

const stableId = (prefix, value) =>
  `${prefix}_${createHash("sha1").update(value).digest("hex").slice(0, 12)}`;

const compact = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const uiRecords = sourceRecords.map((record) => ({
  id: record.candidate_id,
  targetNumber: record.target_record_number,
  name: record.display_name,
  profession: record.profession,
  practices: record.practice_names,
  roleTitles: record.role_titles,
  websites: record.websites,
  phones: record.business_phones,
  emails: record.business_emails,
  locations: record.locations,
  profileUrls: record.profile_urls,
  services: record.broad_service_categories_raw,
  funding: record.funding_types_raw,
  languages: record.languages_raw,
  telehealth: record.telehealth,
  acceptingNewReferrals: record.accepting_new_referrals,
  sources: record.source_urls,
  professionEvidence: record.profession_evidence,
  zones: record.discovery_zones,
  identityReview: record.identity_review,
  reviewStatus: record.review_status,
  ahpraRegistrationNumber: record.ahpra_registration_number,
  ahpraVerificationStatus: record.ahpra_verification_status,
  ahpraVerifiedAt: record.ahpra_verified_at,
  providerConfirmationStatus: record.provider_confirmation_status,
  providerConfirmedAt: record.provider_confirmed_at,
}));

const practitioners = [];
const practiceMap = new Map();
const locationMap = new Map();
const practitionerPractices = [];
const evidence = [];
const attributes = [];

for (const record of sourceRecords) {
  practitioners.push({
    id: record.candidate_id,
    display_name: record.display_name,
    profession: record.profession,
    lifecycle_status: "candidate",
    review_status: record.review_status,
    identity_review: record.identity_review,
    ahpra_registration_number: record.ahpra_registration_number,
    ahpra_verification_status: record.ahpra_verification_status,
    ahpra_verified_at: record.ahpra_verified_at,
    provider_confirmation_status: record.provider_confirmation_status,
    provider_confirmed_at: record.provider_confirmed_at,
  });

  for (const affiliation of record.affiliations ?? []) {
    const practiceKey = `${affiliation.website ?? ""}|${affiliation.practice_name ?? ""}`.toLowerCase();
    const practiceId = stableId("practice", practiceKey);
    if (!practiceMap.has(practiceId)) {
      practiceMap.set(practiceId, {
        id: practiceId,
        name: affiliation.practice_name,
        website: compact(affiliation.website),
        business_phone: compact(affiliation.business_phone),
        business_email: compact(affiliation.business_email)?.toLowerCase() ?? null,
      });
    }

    practitionerPractices.push({
      practitioner_id: record.candidate_id,
      practice_id: practiceId,
      role_title: record.role_titles?.[0] ?? null,
      profile_url: compact(affiliation.profile_url),
      profession_evidence: compact(affiliation.profession_evidence),
    });

    for (const location of affiliation.locations ?? []) {
      const locationKey = [
        practiceId,
        location.address ?? "",
        location.suburb ?? "",
        location.postcode ?? "",
      ].join("|").toLowerCase();
      const locationId = stableId("location", locationKey);
      if (!locationMap.has(locationId)) {
        locationMap.set(locationId, {
          id: locationId,
          practice_id: practiceId,
          address: compact(location.address),
          suburb: compact(location.suburb),
          postcode: compact(location.postcode),
          state: compact(location.state) ?? "NSW",
          latitude: null,
          longitude: null,
          source_url: compact(location.sourceUrl),
        });
      }
    }
  }

  for (const [index, source] of (record.source_urls ?? []).entries()) {
    evidence.push({
      id: stableId("evidence", `${record.candidate_id}|${source}|${index}`),
      practitioner_id: record.candidate_id,
      field_name: "practitioner_profile",
      observed_value: record.profession_evidence?.[index] ?? record.display_name,
      source_url: source,
      source_type: "primary_practice_website",
      confidence: "source_backed_candidate",
    });
  }

  const addAttributes = (type, values) => {
    for (const value of values ?? []) {
      attributes.push({
        id: stableId("attribute", `${record.candidate_id}|${type}|${value}`),
        practitioner_id: record.candidate_id,
        attribute_type: type,
        observed_value: String(value),
        provider_confirmed: false,
      });
    }
  };

  addAttributes("service", record.broad_service_categories_raw);
  addAttributes("funding", record.funding_types_raw);
  addAttributes("language", record.languages_raw);
  if (record.telehealth !== null) addAttributes("telehealth", [record.telehealth]);
  if (record.accepting_new_referrals !== null) {
    addAttributes("accepting_new_referrals", [record.accepting_new_referrals]);
  }
}

const importBundle = {
  manifest: {
    format: "returnwell-candidate-import-v1",
    generated_at: new Date().toISOString(),
    source: "private-data/sydney-master/target-200-ahpra-review.json",
    publication_status: "private_candidate_data",
    activation_rule: "AHPRA verification and practitioner confirmation required",
    counts: {
      practitioners: practitioners.length,
      practices: practiceMap.size,
      practice_locations: locationMap.size,
      practitioner_practices: practitionerPractices.length,
      evidence: evidence.length,
      attributes: attributes.length,
    },
  },
  practitioners,
  practices: [...practiceMap.values()],
  practice_locations: [...locationMap.values()],
  practitioner_practices: practitionerPractices,
  practitioner_evidence: evidence,
  practitioner_attributes: attributes,
};

await mkdir(new URL("../app/data/", import.meta.url), { recursive: true });
await mkdir(new URL("../public/", import.meta.url), { recursive: true });
await writeFile(uiOutputUrl, `${JSON.stringify(uiRecords, null, 2)}\n`);
await writeFile(importOutputUrl, `${JSON.stringify(importBundle, null, 2)}\n`);

console.log(JSON.stringify(importBundle.manifest.counts, null, 2));
