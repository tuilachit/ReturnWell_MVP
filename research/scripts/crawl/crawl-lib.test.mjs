import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeUrl,
  dedupeSearchResults,
  isGreaterSydneyPostcode,
  mergePageExtractions,
  normalizeProfession,
  parseDotEnv,
  personNameKey,
  registrableDomain,
  scoreEvidenceUrl,
  selectBalancedResults,
  selectEvidenceUrls,
} from "./crawl-lib.mjs";

test("parseDotEnv reads a key without changing embedded equals signs", () => {
  assert.deepEqual(parseDotEnv("FIRECRAWL_API_KEY='fc-test=abc'\nEMPTY=\n"), {
    FIRECRAWL_API_KEY: "fc-test=abc",
    EMPTY: "",
  });
});

test("registrableDomain handles Australian second-level domains", () => {
  assert.equal(registrableDomain("https://www.example.com.au/team"), "example.com.au");
  assert.equal(registrableDomain("https://clinic.example.org.au/"), "example.org.au");
  assert.equal(registrableDomain("https://www.example.com/team"), "example.com");
});

test("canonicalizeUrl strips query strings, fragments and trailing slashes", () => {
  assert.equal(
    canonicalizeUrl("https://EXAMPLE.com.au/team/?utm_source=x#bio"),
    "https://example.com.au/team",
  );
});

test("search results are excluded and deduplicated by practice domain", () => {
  const results = dedupeSearchResults([
    { url: "https://example.com.au/team", title: "Team" },
    { url: "https://www.example.com.au/contact", title: "Contact" },
    { url: "https://www.ahpra.gov.au/search", title: "AHPRA" },
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].domain, "example.com.au");
});

test("search deduplication keeps the strongest evidence page for a domain", () => {
  const results = dedupeSearchResults([
    { url: "https://example.com.au/contact", title: "Contact" },
    { url: "https://example.com.au/our-team", title: "Our Team" },
  ]);
  assert.equal(results[0].url, "https://example.com.au/our-team");
});

test("government domains are excluded", () => {
  const results = dedupeSearchResults([
    { url: "https://www.schn.health.nsw.gov.au/physiotherapy", title: "Hospital" },
  ]);
  assert.equal(results.length, 0);
});

test("non-production hosts are excluded", () => {
  const results = dedupeSearchResults([
    { url: "https://staging.example.com.au/our-team", title: "Our Team" },
    { url: "https://www.example.com.au/our-team", title: "Our Team" },
  ]);
  assert.deepEqual(results.map(({ url }) => url), ["https://www.example.com.au/our-team"]);
});

test("balanced selection round-robins profession and zone groups", () => {
  const selected = selectBalancedResults(
    [
      { domain: "physio-one.test", profession: "physiotherapist", zone: "east" },
      { domain: "physio-two.test", profession: "physiotherapist", zone: "east" },
      { domain: "psych-one.test", profession: "psychologist", zone: "east" },
      { domain: "physio-west.test", profession: "physiotherapist", zone: "west" },
      { domain: "psych-west.test", profession: "psychologist", zone: "west" },
    ],
    4,
  );
  assert.deepEqual(selected.map(({ domain }) => domain), [
    "physio-one.test",
    "psych-one.test",
    "physio-west.test",
    "psych-west.test",
  ]);
});

test("team and practitioner pages outrank blogs and privacy pages", () => {
  assert.ok(
    scoreEvidenceUrl("https://example.com.au/our-team") >
      scoreEvidenceUrl("https://example.com.au/services"),
  );
  assert.equal(scoreEvidenceUrl("https://example.com.au/blog/our-team"), -100);
  assert.equal(scoreEvidenceUrl("https://example.com.au/privacy"), -100);
  assert.equal(scoreEvidenceUrl("https://example.com.au/blocks/footer-physio"), -100);
  assert.equal(scoreEvidenceUrl("https://example.com.au/blocks-sitemap.xml"), -100);
  assert.equal(scoreEvidenceUrl("https://example.com.au/2026/08/clinic-news"), -100);
  assert.equal(scoreEvidenceUrl("https://example.com.au/post/team-update"), -100);
});

test("evidence selection keeps the best unique pages", () => {
  const selected = selectEvidenceUrls(
    [
      { url: "https://example.com.au/blog/news", title: "News" },
      { url: "https://example.com.au/our-team", title: "Our team" },
      { url: "https://example.com.au/contact", title: "Contact" },
    ],
    "https://example.com.au/physiotherapists/jane-doe",
    3,
  );
  assert.equal(selected[0], "https://example.com.au/our-team");
  assert.ok(selected.includes("https://example.com.au/contact"));
  assert.ok(selected.includes("https://example.com.au/"));
  assert.ok(!selected.some((url) => url.includes("blog")));
});

test("profession normalization accepts expected synonyms only", () => {
  assert.equal(normalizeProfession("Senior Physiotherapist"), "physiotherapist");
  assert.equal(normalizeProfession("Clinical Psychologist"), "psychologist");
  assert.equal(normalizeProfession("Occupational Therapist"), null);
});

test("professional name keys remove honorifics", () => {
  assert.equal(personNameKey("Dr. Michael Fitzpatrick"), "michael fitzpatrick");
  assert.equal(personNameKey("Michael Fitzpatrick"), "michael fitzpatrick");
});

test("Greater Sydney postcode screening includes the planned regions", () => {
  assert.equal(isGreaterSydneyPostcode("2031"), true);
  assert.equal(isGreaterSydneyPostcode("2560"), true);
  assert.equal(isGreaterSydneyPostcode("2777"), true);
  assert.equal(isGreaterSydneyPostcode("2300"), false);
  assert.equal(isGreaterSydneyPostcode("2790"), false);
  assert.equal(isGreaterSydneyPostcode(null), false);
});

test("page extractions merge duplicate practitioners and preserve evidence", () => {
  const practices = mergePageExtractions([
    {
      metadata: { sourceURL: "https://example.com.au/team" },
      json: {
        practice: {
          practice_name: "Example Health",
          business_phone: "02 9000 0000",
          business_email: "hello@example.com.au",
          locations: [
            { address: "1 High St", suburb: "Sydney", postcode: "2000", state: "NSW" },
          ],
        },
        practitioners: [
          {
            display_name: "Jane Doe",
            profession: "Physiotherapist",
            profession_evidence: "Jane is a senior physiotherapist",
            role_title: "Senior Physiotherapist",
            profile_url: "https://example.com.au/team/jane-doe",
            broad_service_categories_raw: ["Musculoskeletal"],
            funding_types_raw: [],
            languages_raw: [],
            telehealth: null,
            accepting_new_referrals: null,
            ahpra_registration_number: null,
          },
        ],
      },
    },
    {
      metadata: { sourceURL: "https://example.com.au/team/jane-doe" },
      json: {
        practice: {
          practice_name: "Example Health",
          business_phone: null,
          business_email: null,
          locations: [],
        },
        practitioners: [
          {
            display_name: "Jane Doe",
            profession: "Physio",
            profession_evidence: "Physiotherapist Jane Doe",
            role_title: null,
            profile_url: null,
            broad_service_categories_raw: [],
            funding_types_raw: ["Medicare"],
            languages_raw: ["English"],
            telehealth: true,
            accepting_new_referrals: null,
            ahpra_registration_number: null,
          },
        ],
      },
    },
  ]);

  assert.equal(practices.length, 1);
  assert.equal(practices[0].practitioners.length, 1);
  assert.deepEqual(practices[0].practitioners[0].fundingTypesRaw, ["Medicare"]);
  assert.deepEqual(practices[0].practitioners[0].languagesRaw, ["English"]);
  assert.equal(practices[0].practitioners[0].telehealth, true);
  assert.equal(practices[0].sourceUrls.length, 2);
});

test("page extraction rejects a conflicting current profession", () => {
  const practices = mergePageExtractions([
    {
      metadata: { sourceURL: "https://example.com.au/team" },
      json: {
        practice: {
          practice_name: "Example Health",
          business_phone: null,
          business_email: null,
          locations: [],
        },
        practitioners: [
          {
            display_name: "Alex Example",
            profession: "Physiotherapist",
            profession_evidence: "completed a physiotherapy degree",
            role_title: "Exercise Physiologist",
            profile_url: null,
            broad_service_categories_raw: [],
            funding_types_raw: [],
            languages_raw: [],
            telehealth: null,
            accepting_new_referrals: null,
            ahpra_registration_number: null,
          },
        ],
      },
    },
  ]);
  assert.equal(practices[0].practitioners.length, 0);
});

test("page extraction rejects generic profession evidence not tied to the person", () => {
  const practices = mergePageExtractions([
    {
      metadata: { sourceURL: "https://example.com.au/team" },
      json: {
        practice: {
          practice_name: "Example Psychology",
          business_phone: null,
          business_email: null,
          locations: [],
        },
        practitioners: [
          {
            display_name: "Taylor Example",
            profession: "Psychologist",
            profession_evidence: "Our team of experienced psychologists",
            role_title: null,
            profile_url: null,
            broad_service_categories_raw: [],
            funding_types_raw: [],
            languages_raw: [],
            telehealth: null,
            accepting_new_referrals: null,
            ahpra_registration_number: null,
          },
        ],
      },
    },
  ]);
  assert.equal(practices[0].practitioners.length, 0);
});

test("page extraction rejects first-name-only candidates", () => {
  const practices = mergePageExtractions([
    {
      metadata: { sourceURL: "https://example.com.au/team" },
      json: {
        practice: {
          practice_name: "Example Physio",
          business_phone: null,
          business_email: null,
          locations: [],
        },
        practitioners: [
          {
            display_name: "Alex",
            profession: "Physiotherapist",
            profession_evidence: "Alex - Physiotherapist",
            role_title: "Physiotherapist",
            profile_url: null,
            broad_service_categories_raw: [],
            funding_types_raw: [],
            languages_raw: [],
            telehealth: null,
            accepting_new_referrals: null,
            ahpra_registration_number: null,
          },
        ],
      },
    },
  ]);
  assert.equal(practices[0].practitioners.length, 0);
});
