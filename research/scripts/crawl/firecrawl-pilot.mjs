#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXCLUDED_DOMAINS,
  dedupeSearchResults,
  flattenCandidates,
  mergePageExtractions,
  parseDotEnv,
  personNameKey,
  safeRunId,
  selectBalancedResults,
  selectEvidenceUrls,
  toCsv,
} from "./crawl-lib.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, "../..");
const envPath = path.join(workspaceRoot, ".env.local");
const privateDataRoot = path.join(workspaceRoot, "private-data", "crawl-runs");
const mode = process.argv.includes("--scale")
  ? "scale"
  : process.argv.includes("--pilot")
    ? "pilot"
    : "smoke";
const professionIndex = process.argv.indexOf("--profession");
const requestedProfession = professionIndex >= 0 ? process.argv[professionIndex + 1] : null;
const skipMap = process.argv.includes("--skip-map");
const reusePagesIndex = process.argv.indexOf("--reuse-pages");
const reusePagesFile = reusePagesIndex >= 0 ? process.argv[reusePagesIndex + 1] : null;

const LIMITS = mode === "scale"
  ? {
      maxSearchQueries: numberSetting("MAX_SEARCH_QUERIES", 32),
      maxDomains: numberSetting("MAX_DOMAINS", 40),
      maxPagesPerDomain: numberSetting("MAX_PAGES_PER_DOMAIN", 2),
      maxTotalPages: numberSetting("MAX_TOTAL_PAGES", 80),
      maxConcurrency: numberSetting("MAX_CONCURRENCY", 2),
    }
  : mode === "pilot"
  ? {
      maxSearchQueries: numberSetting("MAX_SEARCH_QUERIES", 16),
      maxDomains: numberSetting("MAX_DOMAINS", 20),
      maxPagesPerDomain: numberSetting("MAX_PAGES_PER_DOMAIN", 2),
      maxTotalPages: numberSetting("MAX_TOTAL_PAGES", 40),
      maxConcurrency: numberSetting("MAX_CONCURRENCY", 2),
    }
  : {
      maxSearchQueries: numberSetting("MAX_SEARCH_QUERIES", 4),
      maxDomains: numberSetting("MAX_DOMAINS", 6),
      maxPagesPerDomain: numberSetting("MAX_PAGES_PER_DOMAIN", 2),
      maxTotalPages: numberSetting("MAX_TOTAL_PAGES", 12),
      maxConcurrency: numberSetting("MAX_CONCURRENCY", 2),
    };

const SEARCH_QUERIES = [
  {
    query: "physiotherapist Randwick NSW our team",
    profession: "physiotherapist",
    zone: "City and Eastern Suburbs",
  },
  {
    query: "psychologist Randwick NSW our team",
    profession: "psychologist",
    zone: "City and Eastern Suburbs",
  },
  {
    query: "physiotherapist Penrith NSW our team",
    profession: "physiotherapist",
    zone: "Penrith, Blue Mountains and Macarthur",
  },
  {
    query: "psychologist Penrith NSW our team",
    profession: "psychologist",
    zone: "Penrith, Blue Mountains and Macarthur",
  },
  {
    query: "physiotherapist Marrickville NSW practitioners",
    profession: "physiotherapist",
    zone: "Inner West and Canterbury-Bankstown",
  },
  {
    query: "psychologist Marrickville NSW practitioners",
    profession: "psychologist",
    zone: "Inner West and Canterbury-Bankstown",
  },
  {
    query: "physiotherapist Chatswood NSW our team",
    profession: "physiotherapist",
    zone: "North Shore and Northern Beaches",
  },
  {
    query: "psychologist Chatswood NSW our team",
    profession: "psychologist",
    zone: "North Shore and Northern Beaches",
  },
  {
    query: "physiotherapist Parramatta NSW practitioners",
    profession: "physiotherapist",
    zone: "Parramatta, Ryde and Cumberland",
  },
  {
    query: "psychologist Parramatta NSW practitioners",
    profession: "psychologist",
    zone: "Parramatta, Ryde and Cumberland",
  },
  {
    query: "physiotherapist Blacktown NSW our team",
    profession: "physiotherapist",
    zone: "Blacktown, The Hills and Hawkesbury",
  },
  {
    query: "psychologist Blacktown NSW our team",
    profession: "psychologist",
    zone: "Blacktown, The Hills and Hawkesbury",
  },
  {
    query: "physiotherapist Sutherland NSW practitioners",
    profession: "physiotherapist",
    zone: "St George, Bayside and Sutherland",
  },
  {
    query: "psychologist Sutherland NSW practitioners",
    profession: "psychologist",
    zone: "St George, Bayside and Sutherland",
  },
  {
    query: "physiotherapist Liverpool NSW our team",
    profession: "physiotherapist",
    zone: "Liverpool, Fairfield and Southwest Sydney",
  },
  {
    query: "psychologist Liverpool NSW our team",
    profession: "psychologist",
    zone: "Liverpool, Fairfield and Southwest Sydney",
  },
];

const SCALE_ZONES = [
  { zone: "City and Eastern Suburbs", anchors: ["Randwick", "Bondi Junction", "Sydney CBD", "Maroubra"] },
  { zone: "Inner West and Canterbury-Bankstown", anchors: ["Marrickville", "Newtown", "Burwood", "Bankstown"] },
  { zone: "North Shore and Northern Beaches", anchors: ["Chatswood", "North Sydney", "Hornsby", "Dee Why"] },
  { zone: "Parramatta, Ryde and Cumberland", anchors: ["Parramatta", "Ryde", "Auburn", "Epping"] },
  { zone: "Blacktown, The Hills and Hawkesbury", anchors: ["Blacktown", "Castle Hill", "Rouse Hill", "Windsor"] },
  { zone: "St George, Bayside and Sutherland", anchors: ["Sutherland", "Kogarah", "Hurstville", "Rockdale"] },
  { zone: "Liverpool, Fairfield and Southwest Sydney", anchors: ["Liverpool", "Fairfield", "Cabramatta", "Leppington"] },
  { zone: "Penrith, Blue Mountains and Macarthur", anchors: ["Penrith", "Campbelltown", "Camden", "Springwood"] },
];

const activeSearchQueries = mode === "scale"
  ? buildScaleQueries(requestedProfession)
  : SEARCH_QUERIES;

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    practice: {
      type: "object",
      additionalProperties: false,
      properties: {
        practice_name: { type: ["string", "null"] },
        business_phone: { type: ["string", "null"] },
        business_email: { type: ["string", "null"] },
        locations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              address: { type: ["string", "null"] },
              suburb: { type: ["string", "null"] },
              postcode: { type: ["string", "null"] },
              state: { type: ["string", "null"] },
            },
            required: ["address", "suburb", "postcode", "state"],
          },
        },
      },
      required: ["practice_name", "business_phone", "business_email", "locations"],
    },
    practitioners: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          display_name: { type: ["string", "null"] },
          profession: { type: ["string", "null"] },
          profession_evidence: { type: ["string", "null"] },
          role_title: { type: ["string", "null"] },
          profile_url: { type: ["string", "null"] },
          broad_service_categories_raw: { type: "array", items: { type: "string" } },
          funding_types_raw: { type: "array", items: { type: "string" } },
          languages_raw: { type: "array", items: { type: "string" } },
          telehealth: { type: ["boolean", "null"] },
          accepting_new_referrals: { type: ["boolean", "null"] },
          ahpra_registration_number: { type: ["string", "null"] },
        },
        required: [
          "display_name",
          "profession",
          "profession_evidence",
          "role_title",
          "profile_url",
          "broad_service_categories_raw",
          "funding_types_raw",
          "languages_raw",
          "telehealth",
          "accepting_new_referrals",
          "ahpra_registration_number",
        ],
      },
    },
  },
  required: ["practice", "practitioners"],
};

const EXTRACTION_PROMPT = [
  "Extract only information explicitly stated on this page. Do not infer missing values.",
  "This is an Australian allied health practice directory record.",
  "Identify named individual physiotherapists or psychologists, their practice relationship,",
  "practice locations, broad services, funding statements, languages, telehealth availability,",
  "and whether the page explicitly says they are accepting new referrals.",
  "Use null for every unstated scalar value and an empty array for every unstated list.",
  "Include a person only when the page explicitly identifies their current professional role as",
  "a physiotherapist or psychologist. Never infer profession from the clinic type, page context,",
  "qualifications alone, or another team member. Exclude people with a conflicting current role.",
  "For profession_evidence, return the shortest exact page text that contains both the person's",
  "name and their explicit physiotherapist or psychologist role. If the name and profession cannot",
  "both be supported by the page, exclude the person rather than returning generic team language.",
  "Do not extract patient stories, testimonials, reviews, profile photos, personal social accounts,",
  "or personal information unrelated to the practitioner's professional role.",
].join(" ");

const CANDIDATE_COLUMNS = [
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

const envContents = await fs.readFile(envPath, "utf8");
const env = { ...parseDotEnv(envContents), ...process.env };
const apiKey = env.FIRECRAWL_API_KEY;
if (!apiKey) throw new Error("FIRECRAWL_API_KEY is missing from .env.local");

const runId = safeRunId();
const runDirectory = path.join(privateDataRoot, `${mode}-${runId}`);
await fs.mkdir(runDirectory, { recursive: true });

const manifest = [];
let observedCredits = 0;
const apiRequestTimestamps = [];

console.log(`Starting ${mode} crawl with limits: ${JSON.stringify(LIMITS)}`);
console.log(`Private output: ${runDirectory}`);

const rawSearchResults = [];
let domains = [];
let pages = [];

if (reusePagesFile) {
  const resolved = path.resolve(workspaceRoot, reusePagesFile);
  pages = JSON.parse(await fs.readFile(resolved, "utf8"));
  console.log(`Reusing page list from ${resolved}; discovery API calls are skipped.`);
} else {
  for (const search of activeSearchQueries.slice(0, LIMITS.maxSearchQueries)) {
    console.log(`Search: ${search.query}`);
    const response = await firecrawl("/v2/search", {
      method: "POST",
      body: {
        query: search.query,
        limit: 10,
        sources: ["web"],
      country: "AU",
      location: "Sydney, New South Wales, Australia",
      timeout: 60_000,
      ignoreInvalidURLs: true,
        excludeDomains: EXCLUDED_DOMAINS,
      },
    });
    observedCredits += Number(response?.creditsUsed ?? 0);
    const webResults = Array.isArray(response?.data?.web) ? response.data.web : [];
    for (const result of webResults) rawSearchResults.push({ ...result, ...search });
    manifest.push({
      type: "search",
      query: search.query,
      zone: search.zone,
      profession: search.profession,
      result_count: webResults.length,
      credits_used: response?.creditsUsed ?? null,
      timestamp: new Date().toISOString(),
    });
  }

  const knownDomains = mode === "scale" ? await loadKnownDomains() : new Set();
  domains = selectBalancedResults(
    dedupeSearchResults(rawSearchResults).filter(({ domain }) => !knownDomains.has(domain)),
    LIMITS.maxDomains,
  );
  await writeJson("discovered-domains.json", domains);
  console.log(`Selected ${domains.length} balanced primary domains from ${rawSearchResults.length} search results.`);
  if (mode === "scale") console.log(`Excluded ${knownDomains.size} domains found in earlier runs.`);

  for (const [index, domain] of domains.entries()) {
    if (skipMap) {
      const selected = selectEvidenceUrls([], domain.url, LIMITS.maxPagesPerDomain);
      for (const url of selected) {
        if (pages.length >= LIMITS.maxTotalPages) break;
        pages.push({ url, domain: domain.domain, zone: domain.zone, profession: domain.profession });
      }
      manifest.push({
        type: "map_skipped",
        domain: domain.domain,
        selected_pages: selected.length,
        timestamp: new Date().toISOString(),
      });
      if (pages.length >= LIMITS.maxTotalPages) break;
      continue;
    }
    console.log(`Map ${index + 1}/${domains.length}: ${domain.domain}`);
    try {
      const response = await firecrawl("/v2/map", {
        method: "POST",
        body: {
          url: new URL(domain.url).origin,
          sitemap: "include",
          includeSubdomains: false,
          ignoreQueryParameters: true,
          limit: 100,
          location: { country: "AU", languages: ["en-AU"] },
        },
      });
      const selected = selectEvidenceUrls(
        response?.links,
        domain.url,
        LIMITS.maxPagesPerDomain,
      );
      for (const url of selected) {
        if (pages.length >= LIMITS.maxTotalPages) break;
        pages.push({ url, domain: domain.domain, zone: domain.zone, profession: domain.profession });
      }
      manifest.push({
        type: "map",
        domain: domain.domain,
        discovered_links: Array.isArray(response?.links) ? response.links.length : 0,
        selected_pages: selected.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      manifest.push({
        type: "map_error",
        domain: domain.domain,
        error: safeError(error),
        timestamp: new Date().toISOString(),
      });
      console.warn(`Map failed for ${domain.domain}: ${safeError(error)}`);
    }
    if (pages.length >= LIMITS.maxTotalPages) break;
  }
}

const uniquePages = [...new Map(pages.map((page) => [page.url, page])).values()].slice(
  0,
  LIMITS.maxTotalPages,
);
await writeJson("selected-pages.json", uniquePages);
console.log(`Submitting ${uniquePages.length} pages for structured scrape.`);

let documents = [];
let robotsBlocked = [];
let scrapeErrors = [];
if (uniquePages.length > 0) {
  const batch = await firecrawl("/v2/batch/scrape", {
    method: "POST",
    body: {
      urls: uniquePages.map(({ url }) => url),
      maxConcurrency: LIMITS.maxConcurrency,
      ignoreInvalidURLs: true,
      formats: [
        { type: "json", prompt: EXTRACTION_PROMPT, schema: EXTRACTION_SCHEMA },
      ],
      onlyMainContent: true,
      removeBase64Images: true,
      blockAds: true,
      storeInCache: false,
      location: { country: "AU", languages: ["en-AU"] },
    },
  });
  const batchId = batch?.id;
  if (!batchId) throw new Error("Firecrawl did not return a batch scrape ID");
  console.log(`Batch ${batchId} submitted.`);

  const completed = await pollBatch(batchId);
  documents = Array.isArray(completed?.data) ? completed.data : [];
  observedCredits += Number(completed?.creditsUsed ?? 0);

  try {
    const errors = await firecrawl(`/v2/batch/scrape/${batchId}/errors`);
    robotsBlocked = Array.isArray(errors?.robotsBlocked) ? errors.robotsBlocked : [];
    scrapeErrors = Array.isArray(errors?.errors) ? errors.errors : [];
  } catch (error) {
    console.warn(`Could not load batch errors: ${safeError(error)}`);
  }

  manifest.push({
    type: "batch_scrape",
    batch_id: batchId,
    requested_pages: uniquePages.length,
    returned_documents: documents.length,
    robots_blocked: robotsBlocked.length,
    errors: scrapeErrors.length,
    credits_used: completed?.creditsUsed ?? null,
    timestamp: new Date().toISOString(),
  });
}

const scrapedAt = new Date().toISOString();
const practices = mergePageExtractions(documents);
const discoveryByDomain = Map.groupBy(uniquePages, ({ domain }) => domain);
for (const practice of practices) {
  practice.discoveryZones = [
    ...new Set((discoveryByDomain.get(practice.domain) ?? []).map(({ zone }) => zone).filter(Boolean)),
  ];
}
const candidates = flattenCandidates(practices, scrapedAt);
const completeCandidates = candidates.filter((candidate) =>
  candidate.display_name &&
  candidate.profession &&
  candidate.practice_name &&
  candidate.locations.some((location) => location.suburb && location.postcode),
);

await writeJson("page-results.json", sanitizeDocuments(documents));
await writeJson("practice-records.json", practices);
await writeJson("candidate-records.json", candidates);
await fs.writeFile(
  path.join(runDirectory, "candidate-records.csv"),
  toCsv(candidates, CANDIDATE_COLUMNS),
  "utf8",
);
await writeJson("robots-blocked.json", robotsBlocked);
await writeJson("scrape-errors.json", scrapeErrors);
await writeJsonLines("crawl-manifest.jsonl", manifest);

const professionCounts = Object.groupBy(candidates, ({ profession }) => profession ?? "unknown");
const uniqueCandidateCount = new Set(
  candidates.map(({ display_name, profession }) => `${personNameKey(display_name)}|${profession}`),
).size;
const summary = {
  run_id: runId,
  mode,
  limits: LIMITS,
  search_results: rawSearchResults.length,
  primary_domains: domains.length,
  pages_submitted: uniquePages.length,
  documents_returned: documents.length,
  practices_extracted: practices.length,
  practitioner_candidates: candidates.length,
  unique_practitioner_candidates: uniqueCandidateCount,
  complete_candidates: completeCandidates.length,
  candidate_counts_by_profession: Object.fromEntries(
    Object.entries(professionCounts).map(([key, values]) => [key, values.length]),
  ),
  robots_blocked: robotsBlocked.length,
  scrape_errors: scrapeErrors.length,
  observed_credits: observedCredits,
  output_directory: runDirectory,
  created_at: scrapedAt,
};
await writeJson("crawl-summary.json", summary);
await fs.writeFile(
  path.join(runDirectory, "crawl-summary.md"),
  renderSummary(summary),
  "utf8",
);

console.log(`CRAWL_SUMMARY ${JSON.stringify(summary)}`);

function numberSetting(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildScaleQueries(profession) {
  const professions = profession
    ? [profession]
    : ["physiotherapist", "psychologist"];
  for (const value of professions) {
    if (!["physiotherapist", "psychologist"].includes(value)) {
      throw new Error(`Unsupported --profession value: ${value}`);
    }
  }

  const queries = [];
  for (const { zone, anchors } of SCALE_ZONES) {
    for (const currentProfession of professions) {
      const clinic = currentProfession === "physiotherapist" ? "physiotherapy clinic" : "psychology clinic";
      const variants = [
        `"${currentProfession}" ${anchors[0]} NSW "our team"`,
        `${clinic} ${anchors[1]} NSW "meet the team"`,
        `${currentProfession} ${anchors[2]} NSW practitioners`,
        `${clinic} ${anchors[3]} NSW staff`,
      ];
      for (const query of variants) {
        queries.push({ query, profession: currentProfession, zone });
      }
    }
  }
  return queries;
}

async function loadKnownDomains() {
  const known = new Set();
  let directories = [];
  try {
    directories = await fs.readdir(privateDataRoot);
  } catch {
    return known;
  }
  for (const directory of directories) {
    const file = path.join(privateDataRoot, directory, "discovered-domains.json");
    try {
      const records = JSON.parse(await fs.readFile(file, "utf8"));
      for (const record of records) if (record?.domain) known.add(record.domain);
    } catch {
      // Incomplete and validation-only runs may not have discovery output.
    }
  }
  return known;
}

async function firecrawl(endpoint, options = {}) {
  const url = endpoint.startsWith("http") ? endpoint : `https://api.firecrawl.dev${endpoint}`;
  const method = options.method ?? "GET";
  const headers = { Authorization: `Bearer ${apiKey}` };
  if (options.body) headers["Content-Type"] = "application/json";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await awaitRateSlot();
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(90_000),
      });
    } catch (error) {
      if (attempt === 4) {
        throw new Error(
          `Firecrawl ${method} ${new URL(url).pathname} transport failure: ${safeError(error)}`,
        );
      }
      const delay = Math.min(15_000, 1_000 * 2 ** attempt);
      console.warn(`Firecrawl transport failure; retrying in ${delay}ms: ${safeError(error)}`);
      await sleep(delay);
      continue;
    }
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: text.slice(0, 500) };
    }
    if (response.ok) return payload;

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 4) {
      throw new Error(
        `Firecrawl ${method} ${new URL(url).pathname} failed (${response.status}): ${safeError(payload)}`,
      );
    }
    const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
    const messageRetry = String(payload?.error ?? "").match(/retry after\s+(\d+)s/iu);
    const delay = response.status === 429
      ? Number.isFinite(retryAfter)
        ? (retryAfter + 1) * 1000
        : messageRetry
          ? (Number.parseInt(messageRetry[1], 10) + 1) * 1000
          : 60_000
      : Math.min(15_000, 1_000 * 2 ** attempt);
    console.warn(`Firecrawl returned ${response.status}; retrying in ${delay}ms.`);
    await sleep(delay);
  }
  throw new Error("Firecrawl retry loop exited unexpectedly");
}

async function awaitRateSlot() {
  while (true) {
    const now = Date.now();
    while (apiRequestTimestamps.length > 0 && now - apiRequestTimestamps[0] >= 60_000) {
      apiRequestTimestamps.shift();
    }
    if (apiRequestTimestamps.length < 14) {
      apiRequestTimestamps.push(now);
      return;
    }
    const delay = Math.max(250, 60_250 - (now - apiRequestTimestamps[0]));
    console.log(`API pacing: waiting ${Math.ceil(delay / 1000)}s for the Firecrawl rate window.`);
    await sleep(delay);
  }
}

async function pollBatch(batchId) {
  const startedAt = Date.now();
  let lastCompleted = -1;
  while (Date.now() - startedAt < 15 * 60_000) {
    const status = await firecrawl(`/v2/batch/scrape/${batchId}`);
    const completed = Number(status?.completed ?? 0);
    if (completed !== lastCompleted) {
      console.log(`Batch status: ${status?.status ?? "unknown"} ${completed}/${status?.total ?? "?"}`);
      lastCompleted = completed;
    }
    if (status?.status === "completed") return status;
    if (["failed", "cancelled"].includes(status?.status)) {
      throw new Error(`Batch ended with status ${status.status}`);
    }
    await sleep(2_500);
  }
  throw new Error(`Timed out waiting for batch ${batchId}`);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeError(value) {
  if (value instanceof Error) return value.message.replaceAll(apiKey, "[REDACTED]");
  if (typeof value === "string") return value.replaceAll(apiKey, "[REDACTED]").slice(0, 500);
  try {
    return JSON.stringify(value).replaceAll(apiKey, "[REDACTED]").slice(0, 500);
  } catch {
    return "Unknown error";
  }
}

async function writeJson(name, value) {
  await fs.writeFile(
    path.join(runDirectory, name),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

async function writeJsonLines(name, values) {
  await fs.writeFile(
    path.join(runDirectory, name),
    `${values.map((value) => JSON.stringify(value)).join("\n")}\n`,
    "utf8",
  );
}

function renderSummary(summary) {
  return [
    `# Sydney HP ${summary.mode} crawl summary`,
    "",
    `- Run: ${summary.run_id}`,
    `- Search results: ${summary.search_results}`,
    `- Primary domains: ${summary.primary_domains}`,
    `- Pages submitted: ${summary.pages_submitted}`,
    `- Documents returned: ${summary.documents_returned}`,
    `- Practices extracted: ${summary.practices_extracted}`,
    `- Practitioner candidates: ${summary.practitioner_candidates}`,
    `- Unique practitioner candidates: ${summary.unique_practitioner_candidates}`,
    `- Complete candidates before AHPRA review: ${summary.complete_candidates}`,
    `- Physiotherapists: ${summary.candidate_counts_by_profession.physiotherapist ?? 0}`,
    `- Psychologists: ${summary.candidate_counts_by_profession.psychologist ?? 0}`,
    `- Robots blocked: ${summary.robots_blocked}`,
    `- Scrape errors: ${summary.scrape_errors}`,
    `- Observed Firecrawl credits: ${summary.observed_credits}`,
    "",
    "All candidates remain unverified and inactive until manual review and AHPRA verification.",
    "",
  ].join("\n");
}

function sanitizeDocuments(values) {
  return values.map((document) => ({
    json: document?.json ?? null,
    metadata: {
      sourceURL: document?.metadata?.sourceURL ?? null,
      url: document?.metadata?.url ?? null,
      statusCode: document?.metadata?.statusCode ?? null,
      contentType: document?.metadata?.contentType ?? null,
    },
    warning: document?.warning ?? null,
  }));
}
