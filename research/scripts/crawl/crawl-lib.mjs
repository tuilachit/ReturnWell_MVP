import path from "node:path";

export const EXCLUDED_DOMAINS = [
  "ahpra.gov.au",
  "healthdirect.gov.au",
  "healthengine.com.au",
  "hotdoc.com.au",
  "psychologytoday.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "yellowpages.com.au",
  "whitecoat.com.au",
];

const HIGH_VALUE_TERMS = new Map([
  ["team", 100],
  ["practitioner", 95],
  ["staff", 90],
  ["psychologist", 90],
  ["psychology", 85],
  ["physiotherapist", 90],
  ["physiotherapy", 85],
  ["physio", 80],
  ["funding", 80],
  ["fees", 75],
  ["medicare", 75],
  ["dva", 75],
  ["workcover", 75],
  ["workers-compensation", 75],
  ["ctp", 70],
  ["telehealth", 70],
  ["contact", 65],
  ["location", 60],
  ["services", 55],
  ["about", 45],
]);

const LOW_VALUE_TERMS = [
  "/blocks/",
  "blocks-",
  "404-error",
  "footer",
  "header",
  "blog",
  "news",
  "testimonial",
  "review",
  "career",
  "job",
  "privacy",
  "terms",
  "cookie",
  "login",
  "booking",
  "book-online",
  "/post/",
  "tag",
  "category",
  "author",
];

const COMMON_SECOND_LEVEL_AU = new Set([
  "gov.au",
  "edu.au",
  "com.au",
  "net.au",
  "org.au",
  "asn.au",
  "id.au",
]);

export function parseDotEnv(contents) {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function canonicalizeUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.search = "";
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString();
  } catch {
    return null;
  }
}

export function registrableDomain(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./u, "");
    const labels = hostname.split(".").filter(Boolean);
    if (labels.length <= 2) return hostname;
    const finalTwo = labels.slice(-2).join(".");
    if (COMMON_SECOND_LEVEL_AU.has(finalTwo) && labels.length >= 3) {
      return labels.slice(-3).join(".");
    }
    return finalTwo;
  } catch {
    return null;
  }
}

export function isExcludedUrl(value, excludedDomains = EXCLUDED_DOMAINS) {
  let hostname;
  try {
    hostname = new URL(value).hostname.toLowerCase();
  } catch {
    return true;
  }
  if (/^(?:staging|stage|dev|test|preview)\./u.test(hostname)) return true;
  const domain = registrableDomain(value);
  if (!domain) return true;
  if (domain.endsWith(".gov.au")) return true;
  return excludedDomains.some(
    (excluded) => domain === excluded || domain.endsWith(`.${excluded}`),
  );
}

export function selectBalancedResults(results, limit) {
  const groups = new Map();
  for (const result of results) {
    const key = `${result.profession ?? "unknown"}|${result.zone ?? "unknown"}`;
    const group = groups.get(key) ?? [];
    group.push(result);
    group.sort((a, b) => (b.discoveryScore ?? 0) - (a.discoveryScore ?? 0));
    groups.set(key, group);
  }

  const selected = [];
  while (selected.length < limit) {
    let added = false;
    for (const group of groups.values()) {
      const next = group.shift();
      if (!next) continue;
      selected.push(next);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
  }
  return selected;
}

export function dedupeSearchResults(results, excludedDomains = EXCLUDED_DOMAINS) {
  const keptByDomain = new Map();
  for (const result of results) {
    const url = canonicalizeUrl(result?.url);
    if (!url || isExcludedUrl(url, excludedDomains)) continue;
    const domain = registrableDomain(url);
    if (!domain) continue;
    const discoveryScore = scoreEvidenceUrl(url, result?.title);
    if (!Number.isFinite(discoveryScore) || discoveryScore < 0) continue;
    const candidate = {
      domain,
      url,
      title: cleanString(result?.title),
      description: cleanString(result?.description),
      query: cleanString(result?.query),
      zone: cleanString(result?.zone),
      profession: cleanString(result?.profession),
      discoveryScore,
    };
    const existing = keptByDomain.get(domain);
    if (!existing || candidate.discoveryScore > existing.discoveryScore) {
      keptByDomain.set(domain, candidate);
    }
  }
  return [...keptByDomain.values()];
}

export function scoreEvidenceUrl(value, title = "") {
  const url = canonicalizeUrl(value);
  if (!url || isExcludedUrl(url)) return Number.NEGATIVE_INFINITY;
  const parsed = new URL(url);
  if (/\.(xml|json|txt|rss)$/iu.test(parsed.pathname)) return -100;
  if (/\/20\d{2}\/\d{1,2}\//u.test(parsed.pathname)) return -100;
  const haystack = `${parsed.pathname.toLowerCase()} ${String(title).toLowerCase()}`;
  if (LOW_VALUE_TERMS.some((term) => haystack.includes(term))) return -100;
  let score = parsed.pathname === "/" ? 50 : 0;
  for (const [term, weight] of HIGH_VALUE_TERMS) {
    if (haystack.includes(term)) score = Math.max(score, weight);
  }
  const depth = parsed.pathname.split("/").filter(Boolean).length;
  score -= Math.max(0, depth - 2) * 5;
  return score;
}

export function selectEvidenceUrls(links, seedUrl, limit = 4) {
  const byUrl = new Map();
  const candidates = [
    { url: seedUrl, title: "Search result" },
    { url: new URL(seedUrl).origin, title: "Homepage" },
    ...(Array.isArray(links) ? links : []),
  ];
  for (const item of candidates) {
    const url = canonicalizeUrl(typeof item === "string" ? item : item?.url);
    if (!url || isExcludedUrl(url)) continue;
    const title = typeof item === "string" ? "" : item?.title;
    const score = scoreEvidenceUrl(url, title);
    if (!Number.isFinite(score) || score < 0) continue;
    const parsed = new URL(url);
    const identity = `${parsed.hostname.replace(/^www\./u, "")}${parsed.pathname}`;
    const existing = byUrl.get(identity);
    if (
      !existing ||
      score > existing.score ||
      (score === existing.score && parsed.protocol === "https:" && new URL(existing.url).protocol !== "https:")
    ) {
      byUrl.set(identity, { url, score });
    }
  }
  const ranked = [...byUrl.values()].sort(
    (a, b) => b.score - a.score || a.url.localeCompare(b.url),
  );
  const selected = [];
  const priorities = [
    (url) => /\/(our-)?team|\/staff|\/practitioners?/u.test(new URL(url).pathname),
    (url) => /contact|locations?/u.test(new URL(url).pathname),
    (url) => /funding|fees|medicare|dva|workcover|workers-compensation|ctp|telehealth/u.test(
      new URL(url).pathname,
    ),
    (url) => new URL(url).pathname === "/",
  ];
  for (const matches of priorities) {
    const candidate = ranked.find(({ url }) => !selected.includes(url) && matches(url));
    if (candidate) selected.push(candidate.url);
    if (selected.length >= limit) return selected;
  }
  for (const candidate of ranked) {
    if (!selected.includes(candidate.url)) selected.push(candidate.url);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function cleanString(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/gu, " ").trim();
  return cleaned || null;
}

export function normalizeStringArray(value) {
  const input = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(input.map(cleanString).filter(Boolean))];
}

export function normalizeProfession(value) {
  const text = cleanString(value)?.toLowerCase();
  if (!text) return null;
  if (text.includes("psychologist") || text.includes("psychology")) return "psychologist";
  if (text.includes("physiotherapist") || text.includes("physiotherapy") || text === "physio") {
    return "physiotherapist";
  }
  return null;
}

export function personNameKey(value) {
  const tokens = cleanString(value)
    ?.toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/u)
    .filter(Boolean)
    .filter((token) => !["dr", "doctor", "mr", "mrs", "ms", "miss", "prof", "professor"].includes(token));
  return tokens?.join(" ") ?? null;
}

export function hasFullProfessionalName(value) {
  return (personNameKey(value)?.split(/\s+/u).filter(Boolean).length ?? 0) >= 2;
}

export function isGreaterSydneyPostcode(value) {
  const postcodeText = cleanString(value);
  if (!/^\d{4}$/u.test(postcodeText ?? "")) return false;
  const postcode = Number.parseInt(postcodeText, 10);
  return (
    (postcode >= 2000 && postcode <= 2234) ||
    (postcode >= 2555 && postcode <= 2574) ||
    (postcode >= 2745 && postcode <= 2786)
  );
}

export function extractStructuredJson(document) {
  return (
    document?.json ??
    document?.extract ??
    document?.data?.json ??
    document?.data?.extract ??
    null
  );
}

function locationKey(location) {
  return [
    cleanString(location?.address)?.toLowerCase(),
    cleanString(location?.suburb)?.toLowerCase(),
    cleanString(location?.postcode),
  ]
    .filter(Boolean)
    .join("|");
}

function mergeUniqueBy(items, keyFor) {
  const result = [];
  const seen = new Set();
  for (const item of items) {
    const key = keyFor(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function mergePageExtractions(documents) {
  const practices = new Map();

  for (const document of documents) {
    const sourceUrl = canonicalizeUrl(
      document?.metadata?.sourceURL ?? document?.metadata?.url ?? document?.url,
    );
    if (!sourceUrl) continue;
    const domain = registrableDomain(sourceUrl);
    const extracted = extractStructuredJson(document);
    if (!domain || !extracted || typeof extracted !== "object") continue;

    const current = practices.get(domain) ?? {
      domain,
      website: new URL(sourceUrl).origin,
      practiceName: null,
      businessPhone: null,
      businessEmail: null,
      locations: [],
      practitioners: [],
      sourceUrls: [],
    };

    const practice = extracted.practice ?? {};
    current.practiceName ||= cleanString(practice.practice_name ?? practice.practiceName);
    current.businessPhone ||= cleanString(practice.business_phone ?? practice.businessPhone);
    current.businessEmail ||= cleanString(practice.business_email ?? practice.businessEmail)?.toLowerCase();
    current.sourceUrls.push(sourceUrl);

    const rawLocations = [
      ...(Array.isArray(practice.locations) ? practice.locations : []),
      ...(Array.isArray(extracted.locations) ? extracted.locations : []),
    ];
    for (const location of rawLocations) {
      current.locations.push({
        address: cleanString(location?.address),
        suburb: cleanString(location?.suburb),
        postcode: cleanString(location?.postcode),
        state: cleanString(location?.state) ?? "NSW",
        sourceUrl,
      });
    }

    for (const practitioner of Array.isArray(extracted.practitioners)
      ? extracted.practitioners
      : []) {
      const displayName = cleanString(
        practitioner?.display_name ?? practitioner?.displayName ?? practitioner?.name,
      );
      const profession = normalizeProfession(practitioner?.profession ?? practitioner?.role_title);
      const professionEvidence = cleanString(
        practitioner?.profession_evidence ?? practitioner?.professionEvidence,
      );
      const roleTitle = cleanString(practitioner?.role_title ?? practitioner?.roleTitle);
      if (
        !displayName ||
        !hasFullProfessionalName(displayName) ||
        !profession ||
        normalizeProfession(professionEvidence) !== profession ||
        !evidenceNamesPerson(displayName, professionEvidence) ||
        hasConflictingRole(roleTitle, profession)
      ) {
        continue;
      }
      current.practitioners.push({
        displayName,
        profession,
        professionEvidence,
        roleTitle,
        profileUrl: canonicalizeUrl(practitioner?.profile_url ?? practitioner?.profileUrl) ?? sourceUrl,
        broadServiceCategoriesRaw: normalizeStringArray(
          practitioner?.broad_service_categories_raw ?? practitioner?.broadServiceCategoriesRaw,
        ),
        fundingTypesRaw: normalizeStringArray(
          practitioner?.funding_types_raw ?? practitioner?.fundingTypesRaw,
        ),
        languagesRaw: normalizeStringArray(
          practitioner?.languages_raw ?? practitioner?.languagesRaw,
        ),
        telehealth: typeof practitioner?.telehealth === "boolean" ? practitioner.telehealth : null,
        acceptingNewReferrals:
          typeof practitioner?.accepting_new_referrals === "boolean"
            ? practitioner.accepting_new_referrals
            : typeof practitioner?.acceptingNewReferrals === "boolean"
              ? practitioner.acceptingNewReferrals
              : null,
        ahpraRegistrationNumber: cleanString(
          practitioner?.ahpra_registration_number ?? practitioner?.ahpraRegistrationNumber,
        ),
        sourceUrls: [sourceUrl],
      });
    }

    current.locations = mergeUniqueBy(current.locations, locationKey);
    current.sourceUrls = [...new Set(current.sourceUrls)];
    practices.set(domain, current);
  }

  for (const practice of practices.values()) {
    const mergedPractitioners = new Map();
    for (const practitioner of practice.practitioners) {
      const key = `${personNameKey(practitioner.displayName)}|${practitioner.profession}`;
      const existing = mergedPractitioners.get(key);
      if (!existing) {
        mergedPractitioners.set(key, practitioner);
        continue;
      }
      existing.roleTitle ||= practitioner.roleTitle;
      existing.professionEvidence ||= practitioner.professionEvidence;
      existing.profileUrl ||= practitioner.profileUrl;
      existing.telehealth ??= practitioner.telehealth;
      existing.acceptingNewReferrals ??= practitioner.acceptingNewReferrals;
      existing.ahpraRegistrationNumber ||= practitioner.ahpraRegistrationNumber;
      existing.broadServiceCategoriesRaw = normalizeStringArray([
        ...existing.broadServiceCategoriesRaw,
        ...practitioner.broadServiceCategoriesRaw,
      ]);
      existing.fundingTypesRaw = normalizeStringArray([
        ...existing.fundingTypesRaw,
        ...practitioner.fundingTypesRaw,
      ]);
      existing.languagesRaw = normalizeStringArray([
        ...existing.languagesRaw,
        ...practitioner.languagesRaw,
      ]);
      existing.sourceUrls = [...new Set([...existing.sourceUrls, ...practitioner.sourceUrls])];
    }
    practice.practitioners = [...mergedPractitioners.values()];
  }

  return [...practices.values()];
}

export function flattenCandidates(practices, scrapedAt) {
  const candidates = [];
  for (const practice of practices) {
    for (const practitioner of practice.practitioners) {
      candidates.push({
        display_name: practitioner.displayName,
        profession: practitioner.profession,
        profession_evidence: practitioner.professionEvidence,
        role_title: practitioner.roleTitle,
        practice_name: practice.practiceName,
        website: practice.website,
        business_phone: practice.businessPhone,
        business_email: practice.businessEmail,
        locations: practice.locations,
        profile_url: practitioner.profileUrl,
        broad_service_categories_raw: practitioner.broadServiceCategoriesRaw,
        funding_types_raw: practitioner.fundingTypesRaw,
        languages_raw: practitioner.languagesRaw,
        telehealth: practitioner.telehealth,
        accepting_new_referrals: practitioner.acceptingNewReferrals,
        ahpra_registration_number: practitioner.ahpraRegistrationNumber,
        source_urls: [...new Set([...practice.sourceUrls, ...practitioner.sourceUrls])],
        discovery_zones: practice.discoveryZones ?? [],
        scraped_at: scrapedAt,
        review_status: "needs_review",
      });
    }
  }
  return candidates;
}

function hasConflictingRole(roleTitle, expectedProfession) {
  if (!roleTitle) return false;
  const normalizedRole = normalizeProfession(roleTitle);
  if (normalizedRole) return normalizedRole !== expectedProfession;
  return /exercise physiologist|occupational therapist|speech pathologist|dietitian|podiatrist|pilates instructor|reception|administrator|practice manager/iu.test(
    roleTitle,
  );
}

function evidenceNamesPerson(displayName, professionEvidence) {
  if (!displayName || !professionEvidence) return false;
  const nameTokens = displayName
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/u)
    .filter((token) => token.length >= 3 && !["doctor", "dr"].includes(token));
  const evidence = professionEvidence.toLowerCase();
  return nameTokens.some((token) => evidence.includes(token));
}

export function csvEscape(value) {
  const text = value == null ? "" : Array.isArray(value) ? value.join(" | ") : String(value);
  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows, columns) {
  const header = columns.map(csvEscape).join(",");
  const body = rows.map((row) =>
    columns
      .map((column) => {
        const value = column === "locations"
          ? (row.locations ?? [])
              .map((location) =>
                [location.address, location.suburb, location.postcode].filter(Boolean).join(" "),
              )
              .join(" | ")
          : row[column];
        return csvEscape(value);
      })
      .join(","),
  );
  return `${[header, ...body].join("\n")}\n`;
}

export function safeRunId(date = new Date()) {
  return date.toISOString().replace(/[:.]/gu, "-");
}

export function workspaceRoot(importMetaUrl) {
  return path.resolve(path.dirname(new URL(importMetaUrl).pathname), "../..");
}
