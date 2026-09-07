#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalizeUrl,
  cleanString,
  hasFullProfessionalName,
  isGreaterSydneyPostcode,
  isExcludedUrl,
  normalizeStringArray,
  personNameKey,
  registrableDomain,
  toCsv,
} from "./crawl-lib.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, "../..");
const runsRoot = path.join(workspaceRoot, "private-data", "crawl-runs");
const outputRoot = path.join(workspaceRoot, "private-data", "sydney-master");

const explicitRunDirectories = process.argv.slice(2);
const runDirectories = explicitRunDirectories.length > 0
  ? explicitRunDirectories.map((value) => path.resolve(workspaceRoot, value))
  : await findEligibleRuns();

if (runDirectories.length === 0) {
  throw new Error("No completed pilot or scale runs were found.");
}

const sourceRuns = [];
const inputCandidates = [];

for (const runDirectory of runDirectories) {
  assertInsideRunsRoot(runDirectory);
  const summary = await readJson(path.join(runDirectory, "crawl-summary.json"));
  const candidates = await readJson(path.join(runDirectory, "candidate-records.json"));
  if (!Array.isArray(candidates)) {
    throw new Error(`Candidate records are not an array: ${runDirectory}`);
  }
  sourceRuns.push({
    run_id: summary.run_id,
    mode: summary.mode,
    directory: runDirectory,
    candidates: candidates.length,
  });
  for (const candidate of candidates) {
    inputCandidates.push({ ...candidate, source_run_id: summary.run_id });
  }
}

const rejected = [];
const grouped = new Map();

for (const candidate of inputCandidates) {
  const nameKey = personNameKey(candidate.display_name);
  const profession = cleanString(candidate.profession)?.toLowerCase();
  if (!nameKey || !hasFullProfessionalName(candidate.display_name)) {
    rejected.push({ reason: "invalid_name", candidate });
    continue;
  }
  if (!["physiotherapist", "psychologist"].includes(profession)) {
    rejected.push({ reason: "invalid_profession", candidate });
    continue;
  }
  const allowedSourceUrls = normalizeUrls(candidate.source_urls).filter((url) => !isExcludedUrl(url));
  if (!cleanString(candidate.profession_evidence) || allowedSourceUrls.length === 0) {
    rejected.push({ reason: "missing_evidence_or_source", candidate });
    continue;
  }
  const key = `${nameKey}|${profession}`;
  const values = grouped.get(key) ?? [];
  values.push(candidate);
  grouped.set(key, values);
}

const masterCandidates = [...grouped.entries()]
  .map(([identityKey, candidates]) => mergeCandidateGroup(identityKey, candidates))
  .sort((a, b) =>
    a.profession.localeCompare(b.profession) || a.display_name.localeCompare(b.display_name),
  );

const possibleIdentityCollisions = masterCandidates.filter(
  ({ identity_review }) => identity_review === "check_multiple_practices",
);
const completeCandidates = masterCandidates.filter(({ locations }) =>
  locations.some((location) => location.suburb && location.postcode),
);
const sydneySourceCandidates = masterCandidates.filter(({ locations }) =>
  locations.some(
    (location) => location.suburb && isGreaterSydneyPostcode(location.postcode),
  ),
);
const sydneyReviewQueue = sydneySourceCandidates.filter((candidate) =>
  candidate.practice_names.length > 0 &&
  candidate.locations
    .filter(({ postcode }) => postcode)
    .every(({ postcode }) => isGreaterSydneyPostcode(postcode)),
);
const locationScopeReview = sydneySourceCandidates.filter(
  (candidate) => !sydneyReviewQueue.includes(candidate),
);
const professionCounts = countBy(masterCandidates, ({ profession }) => profession);
const zoneCounts = countByMany(masterCandidates, ({ discovery_zones }) => discovery_zones);
const missingness = {
  location_with_postcode: masterCandidates.length - completeCandidates.length,
  business_email: masterCandidates.filter(({ business_emails }) => business_emails.length === 0).length,
  funding_types: masterCandidates.filter(({ funding_types_raw }) => funding_types_raw.length === 0).length,
  languages: masterCandidates.filter(({ languages_raw }) => languages_raw.length === 0).length,
  telehealth: masterCandidates.filter(({ telehealth }) => telehealth == null).length,
  accepting_new_referrals: masterCandidates.filter(
    ({ accepting_new_referrals }) => accepting_new_referrals == null,
  ).length,
};

const generatedAt = new Date().toISOString();
const summary = {
  generated_at: generatedAt,
  source_runs: sourceRuns,
  input_records: inputCandidates.length,
  rejected_records: rejected.length,
  unique_practitioner_candidates: masterCandidates.length,
  complete_candidates: completeCandidates.length,
  candidates_with_a_sydney_source_location: sydneySourceCandidates.length,
  eligible_sydney_candidates: sydneyReviewQueue.length,
  candidates_needing_location_scope_review: locationScopeReview.length,
  candidate_counts_by_profession: professionCounts,
  candidate_counts_by_discovery_zone: zoneCounts,
  possible_identity_collisions: possibleIdentityCollisions.length,
  missingness,
  ahpra_verified: 0,
  status_note: "These are evidence-backed discovery candidates. Manual AHPRA verification and provider confirmation are still required.",
};

await fs.mkdir(outputRoot, { recursive: true });
await writeJson(path.join(outputRoot, "master-candidates.json"), masterCandidates);
await fs.writeFile(
  path.join(outputRoot, "master-candidates.csv"),
  toCsv(masterCandidates, [
    "candidate_id",
    "display_name",
    "profession",
    "role_titles",
    "practice_names",
    "websites",
    "business_phones",
    "business_emails",
    "locations",
    "profile_urls",
    "broad_service_categories_raw",
    "funding_types_raw",
    "languages_raw",
    "telehealth",
    "accepting_new_referrals",
    "discovery_zones",
    "source_urls",
    "identity_review",
    "review_status",
  ]),
  "utf8",
);
await writeJson(path.join(outputRoot, "possible-identity-collisions.json"), possibleIdentityCollisions);
await writeJson(path.join(outputRoot, "location-scope-review.json"), locationScopeReview);
await writeJson(path.join(outputRoot, "ahpra-review-queue.json"), sydneyReviewQueue);
await fs.writeFile(
  path.join(outputRoot, "ahpra-review-queue.csv"),
  toCsv(sydneyReviewQueue, [
    "candidate_id",
    "display_name",
    "profession",
    "practice_names",
    "locations",
    "profile_urls",
    "profession_evidence",
    "source_urls",
    "identity_review",
    "review_status",
  ]),
  "utf8",
);
await writeJson(path.join(outputRoot, "rejected-records.json"), rejected);
await writeJson(path.join(outputRoot, "master-summary.json"), summary);
await fs.writeFile(path.join(outputRoot, "master-summary.md"), renderSummary(summary), "utf8");

console.log(`MASTER_SUMMARY ${JSON.stringify(summary)}`);

async function findEligibleRuns() {
  const entries = await fs.readdir(runsRoot, { withFileTypes: true });
  const eligible = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(runsRoot, entry.name);
    try {
      const summary = await readJson(path.join(directory, "crawl-summary.json"));
      if (!["pilot", "scale"].includes(summary.mode)) continue;
      await fs.access(path.join(directory, "candidate-records.json"));
      eligible.push(directory);
    } catch {
      // An interrupted or incomplete run is not eligible for the master dataset.
    }
  }
  return eligible.sort();
}

function mergeCandidateGroup(identityKey, candidates) {
  const sourceDomains = new Set();
  const affiliations = [];
  for (const candidate of candidates) {
    const website = canonicalizeUrl(candidate.website);
    const domain = website ? registrableDomain(website) : null;
    if (domain) sourceDomains.add(domain);
    affiliations.push({
      practice_name: cleanString(candidate.practice_name),
      website,
      business_phone: cleanString(candidate.business_phone),
      business_email: cleanString(candidate.business_email)?.toLowerCase() ?? null,
      locations: normalizeLocations(candidate.locations),
      profile_url: canonicalizeUrl(candidate.profile_url),
      profession_evidence: cleanString(candidate.profession_evidence),
      source_urls: normalizeUrls(candidate.source_urls),
      source_run_id: candidate.source_run_id,
    });
  }

  const telehealthValues = candidates
    .map(({ telehealth }) => telehealth)
    .filter((value) => typeof value === "boolean");
  const referralValues = candidates
    .map(({ accepting_new_referrals }) => accepting_new_referrals)
    .filter((value) => typeof value === "boolean");

  return {
    candidate_id: `hp_${crypto.createHash("sha256").update(identityKey).digest("hex").slice(0, 12)}`,
    display_name: bestDisplayName(candidates),
    profession: candidates[0].profession,
    profession_evidence: normalizeStringArray(candidates.map(({ profession_evidence }) => profession_evidence)),
    role_titles: normalizeStringArray(candidates.map(({ role_title }) => role_title)),
    practice_names: normalizeStringArray(candidates.map(({ practice_name }) => practice_name)),
    websites: normalizeUrls(candidates.map(({ website }) => website)),
    business_phones: normalizeStringArray(candidates.map(({ business_phone }) => business_phone)),
    business_emails: normalizeStringArray(candidates.map(({ business_email }) => business_email?.toLowerCase())),
    locations: normalizeLocations(candidates.flatMap(({ locations }) => locations ?? [])),
    profile_urls: normalizeUrls(candidates.map(({ profile_url }) => profile_url)),
    broad_service_categories_raw: normalizeStringArray(
      candidates.flatMap(({ broad_service_categories_raw }) => broad_service_categories_raw ?? []),
    ),
    funding_types_raw: normalizeStringArray(
      candidates.flatMap(({ funding_types_raw }) => funding_types_raw ?? []),
    ),
    languages_raw: normalizeStringArray(
      candidates.flatMap(({ languages_raw }) => languages_raw ?? []),
    ),
    telehealth: consensusBoolean(telehealthValues),
    accepting_new_referrals: consensusBoolean(referralValues),
    ahpra_registration_number: null,
    source_urls: normalizeUrls(candidates.flatMap(({ source_urls }) => source_urls ?? [])),
    discovery_zones: normalizeStringArray(
      candidates.flatMap(({ discovery_zones }) => discovery_zones ?? []),
    ),
    source_run_ids: normalizeStringArray(candidates.map(({ source_run_id }) => source_run_id)),
    affiliations: uniqueAffiliations(affiliations),
    identity_review: sourceDomains.size > 1 ? "check_multiple_practices" : "single_practice",
    review_status: "needs_ahpra_verification",
  };
}

function normalizeLocations(locations) {
  const result = new Map();
  for (const location of Array.isArray(locations) ? locations : []) {
    const normalized = {
      address: cleanString(location?.address),
      suburb: cleanString(location?.suburb),
      postcode: cleanString(location?.postcode),
      state: cleanString(location?.state) ?? "NSW",
      sourceUrl: canonicalizeUrl(location?.sourceUrl),
    };
    const key = [normalized.address, normalized.suburb, normalized.postcode]
      .filter(Boolean)
      .join("|")
      .toLowerCase();
    if (key && !result.has(key)) result.set(key, normalized);
  }
  return [...result.values()];
}

function normalizeUrls(values) {
  return [...new Set((Array.isArray(values) ? values : [values]).map(canonicalizeUrl).filter(Boolean))];
}

function uniqueAffiliations(affiliations) {
  const byKey = new Map();
  for (const affiliation of affiliations) {
    const key = [affiliation.practice_name, affiliation.website, affiliation.source_run_id]
      .filter(Boolean)
      .join("|");
    if (key && !byKey.has(key)) byKey.set(key, affiliation);
  }
  return [...byKey.values()];
}

function consensusBoolean(values) {
  if (values.length === 0) return null;
  return values.every((value) => value === values[0]) ? values[0] : null;
}

function bestDisplayName(candidates) {
  return [...candidates]
    .map(({ display_name }) => cleanString(display_name))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length || a.localeCompare(b))[0];
}

function countBy(items, keyFor) {
  const counts = {};
  for (const item of items) {
    const key = keyFor(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function countByMany(items, keysFor) {
  const counts = {};
  for (const item of items) {
    for (const key of keysFor(item)) counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function renderSummary(value) {
  return [
    "# Sydney practitioner candidate master",
    "",
    `Generated: ${value.generated_at}`,
    `Source runs: ${value.source_runs.length}`,
    `Input records: ${value.input_records}`,
    `Unique candidates: ${value.unique_practitioner_candidates}`,
    `Candidates with a suburb and postcode: ${value.complete_candidates}`,
    `Candidates with at least one Greater Sydney source location: ${value.candidates_with_a_sydney_source_location}`,
    `Eligible Greater Sydney candidates for AHPRA review: ${value.eligible_sydney_candidates}`,
    `Candidates needing location-scope review: ${value.candidates_needing_location_scope_review}`,
    `Possible same-name or multi-practice checks: ${value.possible_identity_collisions}`,
    `AHPRA verified: ${value.ahpra_verified}`,
    "",
    value.status_note,
    "",
  ].join("\n");
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertInsideRunsRoot(directory) {
  const relative = path.relative(runsRoot, directory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Run directory must be inside ${runsRoot}`);
  }
}
