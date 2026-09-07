#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  flattenCandidates,
  mergePageExtractions,
  personNameKey,
  toCsv,
} from "./crawl-lib.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, "../..");
const privateDataRoot = path.join(workspaceRoot, "private-data");
const runArgument = process.argv[2];

if (!runArgument) {
  throw new Error("Usage: node scripts/crawl/reprocess-run.mjs <private crawl run directory>");
}

const runDirectory = path.resolve(workspaceRoot, runArgument);
if (!runDirectory.startsWith(`${privateDataRoot}${path.sep}`)) {
  throw new Error("The run directory must be inside the workspace private-data directory");
}

const documents = JSON.parse(await fs.readFile(path.join(runDirectory, "page-results.json"), "utf8"));
const pages = JSON.parse(await fs.readFile(path.join(runDirectory, "selected-pages.json"), "utf8"));
const summaryPath = path.join(runDirectory, "crawl-summary.json");
const existingSummary = JSON.parse(await fs.readFile(summaryPath, "utf8"));

const practices = mergePageExtractions(documents);
const discoveryByDomain = Map.groupBy(pages, ({ domain }) => domain);
for (const practice of practices) {
  practice.discoveryZones = [
    ...new Set((discoveryByDomain.get(practice.domain) ?? []).map(({ zone }) => zone).filter(Boolean)),
  ];
}

const candidates = flattenCandidates(practices, new Date().toISOString());
const completeCandidates = candidates.filter((candidate) =>
  candidate.display_name &&
  candidate.profession &&
  candidate.practice_name &&
  candidate.locations.some((location) => location.suburb && location.postcode),
);
const professionCounts = Object.groupBy(candidates, ({ profession }) => profession ?? "unknown");
const uniqueCandidateCount = new Set(
  candidates.map(({ display_name, profession }) => `${personNameKey(display_name)}|${profession}`),
).size;

const summary = {
  ...existingSummary,
  practices_extracted: practices.length,
  practitioner_candidates: candidates.length,
  unique_practitioner_candidates: uniqueCandidateCount,
  complete_candidates: completeCandidates.length,
  candidate_counts_by_profession: Object.fromEntries(
    Object.entries(professionCounts).map(([key, values]) => [key, values.length]),
  ),
  reprocessed_at: new Date().toISOString(),
};

const columns = [
  "display_name",
  "profession",
  "profession_evidence",
  "role_title",
  "practice_name",
  "website",
  "business_phone",
  "business_email",
  "locations",
  "profile_url",
  "broad_service_categories_raw",
  "funding_types_raw",
  "languages_raw",
  "telehealth",
  "accepting_new_referrals",
  "ahpra_registration_number",
  "source_urls",
  "discovery_zones",
  "scraped_at",
  "review_status",
];

await fs.writeFile(
  path.join(runDirectory, "practice-records.json"),
  `${JSON.stringify(practices, null, 2)}\n`,
  "utf8",
);
await fs.writeFile(
  path.join(runDirectory, "candidate-records.json"),
  `${JSON.stringify(candidates, null, 2)}\n`,
  "utf8",
);
await fs.writeFile(
  path.join(runDirectory, "candidate-records.csv"),
  toCsv(candidates, columns),
  "utf8",
);
await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

console.log(`REPROCESS_SUMMARY ${JSON.stringify(summary)}`);
