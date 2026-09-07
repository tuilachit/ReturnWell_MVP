#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanString, toCsv } from "./crawl-lib.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, "../..");
const masterRoot = path.join(workspaceRoot, "private-data", "sydney-master");
const inputFile = path.join(masterRoot, "ahpra-review-queue.json");

const ZONE_QUOTAS = new Map([
  ["City and Eastern Suburbs", 15],
  ["Inner West and Canterbury-Bankstown", 15],
  ["North Shore and Northern Beaches", 15],
  ["Parramatta, Ryde and Cumberland", 15],
  ["Blacktown, The Hills and Hawkesbury", 10],
  ["St George, Bayside and Sutherland", 10],
  ["Liverpool, Fairfield and Southwest Sydney", 10],
  ["Penrith, Blue Mountains and Macarthur", 10],
]);
const PROFESSION_TARGET = 100;

const candidates = JSON.parse(await fs.readFile(inputFile, "utf8"));
const selectionPool = candidates.filter(
  ({ identity_review }) => identity_review === "single_practice",
);
const selected = [];

for (const profession of ["physiotherapist", "psychologist"]) {
  const pool = selectionPool.filter((candidate) => candidate.profession === profession);
  if (pool.length < PROFESSION_TARGET) {
    throw new Error(`Need ${PROFESSION_TARGET} ${profession} records but only found ${pool.length}.`);
  }

  const chosen = [];
  const chosenIds = new Set();
  const zonesByScarcity = [...ZONE_QUOTAS]
    .map(([zone, quota]) => ({
      zone,
      quota,
      available: pool.filter(({ discovery_zones }) => discovery_zones.includes(zone)).length,
    }))
    .sort((a, b) => a.available / a.quota - b.available / b.quota || a.zone.localeCompare(b.zone));

  for (const { zone, quota } of zonesByScarcity) {
    const zoneCandidates = pool.filter(
      ({ candidate_id, discovery_zones }) =>
        !chosenIds.has(candidate_id) && discovery_zones.includes(zone),
    );
    for (const candidate of choosePracticeDiverse(zoneCandidates, quota)) {
      chosen.push(candidate);
      chosenIds.add(candidate.candidate_id);
    }
  }

  if (chosen.length < PROFESSION_TARGET) {
    const remaining = pool.filter(({ candidate_id }) => !chosenIds.has(candidate_id));
    for (const candidate of choosePracticeDiverse(remaining, PROFESSION_TARGET - chosen.length)) {
      chosen.push(candidate);
      chosenIds.add(candidate.candidate_id);
    }
  }

  selected.push(
    ...chosen.slice(0, PROFESSION_TARGET).map((candidate, index) => ({
      ...candidate,
      selection_rank_within_profession: index + 1,
      ahpra_verification_status: "not_checked",
      ahpra_verified_at: null,
      manual_review_notes: null,
      provider_confirmation_status: "not_contacted",
      provider_confirmed_at: null,
    })),
  );
}

const finalRecords = selected
  .sort((a, b) => a.profession.localeCompare(b.profession) || a.display_name.localeCompare(b.display_name))
  .map((candidate, index) => ({ ...candidate, target_record_number: index + 1 }));

const summary = {
  generated_at: new Date().toISOString(),
  input_candidates: candidates.length,
  candidates_after_identity_gate: selectionPool.length,
  excluded_pending_identity_review: candidates.length - selectionPool.length,
  selected_candidates: finalRecords.length,
  profession_counts: countBy(finalRecords, ({ profession }) => profession),
  zone_targets_per_profession: Object.fromEntries(ZONE_QUOTAS),
  selected_zone_counts_by_profession: Object.fromEntries(
    ["physiotherapist", "psychologist"].map((profession) => [
      profession,
      countByMany(
        finalRecords.filter((candidate) => candidate.profession === profession),
        ({ discovery_zones }) => discovery_zones,
      ),
    ]),
  ),
  unique_practices: new Set(finalRecords.flatMap(({ websites }) => websites)).size,
  review_status: "needs_ahpra_verification",
  note: "This is a source-evidence review queue, not a verified or active ReturnWell directory.",
};

await writeJson(path.join(masterRoot, "target-200-ahpra-review.json"), finalRecords);
await fs.writeFile(
  path.join(masterRoot, "target-200-ahpra-review.csv"),
  toCsv(finalRecords, [
    "target_record_number",
    "candidate_id",
    "display_name",
    "profession",
    "profession_evidence",
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
    "ahpra_registration_number",
    "ahpra_verification_status",
    "ahpra_verified_at",
    "manual_review_notes",
    "provider_confirmation_status",
    "provider_confirmed_at",
  ]),
  "utf8",
);
await writeJson(path.join(masterRoot, "target-200-summary.json"), summary);
await fs.writeFile(
  path.join(masterRoot, "target-200-summary.md"),
  [
    "# Sydney target 200 AHPRA review queue",
    "",
    `Generated: ${summary.generated_at}`,
    `Selected candidates: ${summary.selected_candidates}`,
    `Physiotherapists: ${summary.profession_counts.physiotherapist ?? 0}`,
    `Psychologists: ${summary.profession_counts.psychologist ?? 0}`,
    `Unique practices: ${summary.unique_practices}`,
    "",
    summary.note,
    "",
  ].join("\n"),
  "utf8",
);

console.log(`TARGET_200_SUMMARY ${JSON.stringify(summary)}`);

function choosePracticeDiverse(values, limit) {
  const groups = new Map();
  for (const candidate of [...values].sort(compareCandidateQuality)) {
    const key = candidate.websites[0] ?? candidate.practice_names[0] ?? candidate.candidate_id;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  const chosen = [];
  while (chosen.length < limit) {
    let added = false;
    for (const group of groups.values()) {
      const candidate = group.shift();
      if (!candidate) continue;
      chosen.push(candidate);
      added = true;
      if (chosen.length >= limit) break;
    }
    if (!added) break;
  }
  return chosen;
}

function compareCandidateQuality(a, b) {
  return qualityScore(b) - qualityScore(a) || a.display_name.localeCompare(b.display_name);
}

function qualityScore(candidate) {
  let score = 0;
  if (candidate.identity_review === "single_practice") score += 10;
  if (candidate.business_emails.length > 0) score += 3;
  if (candidate.business_phones.length > 0) score += 2;
  if (candidate.profile_urls.some((url) => personProfileLooksSpecific(url, candidate.display_name))) {
    score += 5;
  }
  score += Math.min(candidate.source_urls.length, 3);
  return score;
}

function personProfileLooksSpecific(url, displayName) {
  const nameTokens = cleanString(displayName)
    ?.toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/u)
    .filter((token) => token.length >= 3) ?? [];
  const normalizedUrl = String(url).toLowerCase();
  return nameTokens.some((token) => normalizedUrl.includes(token));
}

function countBy(items, keyFor) {
  const counts = {};
  for (const item of items) {
    const key = keyFor(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function countByMany(items, keysFor) {
  const counts = {};
  for (const item of items) {
    for (const key of keysFor(item)) counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
