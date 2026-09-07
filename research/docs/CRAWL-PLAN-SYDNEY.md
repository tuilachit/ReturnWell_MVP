# ReturnWell Sydney HP crawl plan

## Objective

Build a reviewed candidate directory containing 200 real allied health practitioners in Greater Sydney:

- 100 physiotherapists
- 100 psychologists
- broad geographic coverage across Greater Sydney
- a primary practice website and source evidence for every record
- current AHPRA registration verified manually before a record is marked `verified`

The crawl creates candidate records. A practitioner must still confirm their directory details and agree to participate before being marked `active` in ReturnWell.

## Definition of a real record

A record counts toward the 200 target only when it has:

1. a practitioner name;
2. an unambiguous profession of physiotherapist or psychologist;
3. a named practice with a primary practice website;
4. at least one Greater Sydney practice location with suburb and postcode;
5. a live source URL showing the practitioner-practice relationship;
6. a scrape timestamp and field-level provenance;
7. a successful manual check against the AHPRA register; and
8. no unresolved duplicate or identity conflict.

`verified` does not mean `active`. Activation requires practitioner confirmation or an invite acceptance.

## Geographic quotas

Use quotas to prevent search ranking from over-representing the CBD and affluent inner suburbs. Adjust these quotas later if the 15 GP practices are concentrated elsewhere.

| Greater Sydney zone | Physiotherapists | Psychologists | Total |
| --- | ---: | ---: | ---: |
| City and Eastern Suburbs | 15 | 15 | 30 |
| Inner West and Canterbury-Bankstown | 15 | 15 | 30 |
| North Shore and Northern Beaches | 15 | 15 | 30 |
| Parramatta, Ryde and Cumberland | 15 | 15 | 30 |
| Blacktown, The Hills and Hawkesbury | 10 | 10 | 20 |
| St George, Bayside and Sutherland | 10 | 10 | 20 |
| Liverpool, Fairfield and Southwest Sydney | 10 | 10 | 20 |
| Penrith, Blue Mountains and Macarthur | 10 | 10 | 20 |
| **Total** | **100** | **100** | **200** |

## Source policy

### Allowed discovery and extraction sources

- primary practitioner or practice websites;
- official practice team, practitioner, service, fees, funding, telehealth and contact pages;
- publicly accessible practice PDFs where relevant;
- search result metadata used only to locate a primary website.

### Verification-only sources

- AHPRA public register, checked manually for each shortlisted practitioner;
- official business or government sources used to resolve a specific conflict.

### Excluded sources

- AHPRA bulk or automated scraping;
- Google Maps page scraping;
- Healthdirect/NHSD page scraping without an applicable data agreement;
- HotDoc, Healthengine and other booking platforms;
- professional association member directories unless reuse permission is obtained;
- social media profiles;
- review, rating and testimonial sites;
- paywalled, authenticated, CAPTCHA-protected or robots-blocked pages;
- data brokers and copied directory sites.

Do not circumvent access controls. When Firecrawl reports a URL under `robotsBlocked`, record the rejection and move on.

## Data to collect

### Practice

- `practice_name`
- `website`
- `business_phone`
- `business_email`
- `source_urls`

### Location

- `address`
- `suburb`
- `postcode`
- `state`
- `latitude` and `longitude`, added later through geocoding
- `location_source_url`

### Practitioner

- `display_name`
- `profession`
- `role_title`
- `practice_name`
- `profile_url`
- `broad_service_categories_raw`
- `funding_types_raw`
- `languages_raw`
- `telehealth`
- `accepting_new_referrals`
- `ahpra_registration_number`, only when published or supplied
- `ahpra_status`, added during manual verification
- `ahpra_verified_at`

### Provenance and review

- `field_name`
- `observed_value`
- `source_url`
- `scraped_at`
- `source_type`
- `confidence`
- `review_status`
- `review_notes`
- `provider_confirmed_at`

Store `null` when a site does not state a value. Never infer a funding type, language, telehealth service, capacity status or acceptance of new referrals.

Do not collect profile photographs, personal social accounts, reviews, testimonials, personal mobile numbers, personal email addresses, biographies unrelated to service fit, or any patient information.

## Record lifecycle

```text
discovered
  -> scraped
  -> extraction_reviewed
  -> deduplicated
  -> ahpra_verified
  -> invited
  -> provider_confirmed
  -> active
```

Only `ahpra_verified` records count toward the 200-record crawl target. Only `active` records appear to GPs.

## Firecrawl workflow

Use Firecrawl API v2 through direct HTTP requests. Keep `FIRECRAWL_API_KEY` in an untracked environment variable. Do not write the key into source code, logs or generated datasets.

### Stage 1: search discovery

Run a query grid across profession and geographic zone. Use multiple suburb anchors within each zone so search ranking does not repeatedly return the same practices.

Query templates:

```text
physiotherapist {suburb} NSW our team
physiotherapy clinic {suburb} NSW practitioners
psychologist {suburb} NSW our team
psychology clinic {suburb} NSW practitioners
```

Use funding, telehealth and language queries only as gap-filling passes after the base sample is geographically balanced:

```text
physiotherapist {suburb} NSW DVA Medicare workers compensation
psychologist {suburb} NSW Medicare telehealth
```

Recommended search request settings:

```json
{
  "limit": 10,
  "sources": ["web"],
  "country": "AU",
  "location": "Sydney, New South Wales, Australia",
  "ignoreInvalidURLs": true,
  "excludeDomains": [
    "ahpra.gov.au",
    "healthdirect.gov.au",
    "healthengine.com.au",
    "hotdoc.com.au",
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "youtube.com"
  ]
}
```

Normalize URLs and deduplicate by registrable domain before mapping.

### Stage 2: site mapping

Map each primary practice domain and retain only likely evidence pages. Start with a per-domain limit of 100 URLs and do not include subdomains unless the main site redirects there.

Prioritize paths or titles containing:

- `team`
- `practitioner`
- `staff`
- `physio`
- `psychologist`
- `psychology`
- `services`
- `fees`
- `funding`
- `medicare`
- `dva`
- `workcover`
- `ctp`
- `telehealth`
- `contact`
- `location`

Reject blog posts, news, testimonials, job advertisements, privacy pages and duplicate query-string URLs.

### Stage 3: structured batch scrape

Batch scrape three to six high-value pages per domain. Begin at low concurrency and increase only after observing plan limits and target-site behaviour.

Recommended settings:

```json
{
  "maxConcurrency": 2,
  "ignoreInvalidURLs": true,
  "onlyMainContent": true,
  "removeBase64Images": true,
  "blockAds": true,
  "storeInCache": false,
  "location": {
    "country": "AU",
    "languages": ["en-AU"]
  }
}
```

Request schema-constrained JSON only. Retain a short profession-evidence phrase and the source URL for review, but do not retain complete page Markdown, testimonials, patient stories or unrelated website content. Reviewers can open the live primary source when additional context is necessary.

The extraction prompt must say:

```text
Extract only information explicitly stated on this page. Do not infer missing values.
This is an Australian allied health practice directory record. Identify named individual
physiotherapists or psychologists, their practice relationship, practice locations, broad
services, funding statements, languages, telehealth availability and whether the page
explicitly says they are accepting new referrals. Use null for every unstated value.
Do not extract patient stories, testimonials, reviews or personal information unrelated
to the practitioner's professional role.
```

### Stage 4: merge and normalize

Merge page-level extractions into domain-level practice records, then split practitioners into individual candidate records.

Normalize:

- whitespace, casing and honorifics in names;
- Australian phone formats;
- lowercase email addresses;
- four-digit postcodes;
- profession synonyms into `physiotherapist` or `psychologist`;
- raw funding labels into a review queue before mapping to product-controlled values;
- raw service descriptions into broad categories only after the product category list is approved.

Keep the raw observed value and source evidence beside every normalized value.

### Stage 5: deduplication

Use the following identifiers in descending order of confidence:

1. AHPRA registration number;
2. normalized full name plus practice domain;
3. normalized full name plus postcode;
4. normalized full name plus business phone;
5. manual resolution.

One practitioner working at multiple practices or locations is one practitioner with multiple role/location records, not multiple people.

Do not auto-merge two people solely because their names match.

### Stage 6: review and AHPRA verification

Generate approximately 350 to 400 candidate practitioners to obtain 200 verified records after duplicates, missing evidence and failed checks are removed.

For each shortlisted record:

1. open the source profile and confirm the practitioner-practice relationship;
2. search AHPRA manually;
3. match name, profession and principal place of practice where available;
4. confirm current practising registration and note the verification timestamp;
5. reject or escalate ambiguous matches;
6. confirm the record contributes to its zone quota.

### Stage 7: practitioner confirmation

After the 200-record research dataset is complete, invite practitioners to confirm:

- business contact details;
- practice locations;
- funding types;
- broad referral categories;
- languages;
- telehealth;
- current referral capacity; and
- agreement to respond to offers within one NSW business day.

Scraped records remain inactive until this confirmation is complete.

## Pilot and scale gates

### Pilot A: extraction accuracy

- 20 practice domains
- no more than 40 scraped pages after the initial extraction validation
- target at least 40 practitioner candidates
- manually review every extracted field
- measure Firecrawl credits used from API responses

Proceed only if:

- at least 90% of candidate practitioners are real people in the stated profession;
- required identity and location fields have at least 95% precision;
- unsupported values are returned as `null`, not invented;
- duplicate-domain and duplicate-person handling works; and
- blocked or excluded sources are recorded correctly.

### Pilot B: geographic yield

- run one complete query set for two contrasting zones;
- compare practitioner yield, source quality and credits per verified candidate;
- revise suburb anchors and page limits before scaling.

### Full run

- discover 120 to 180 primary practice domains;
- begin with approximately 200 to 400 high-value pages and expand only if the measured yield requires it;
- extract 350 to 400 practitioner candidates;
- review and verify until 200 records meet the definition of real;
- stop once both profession and geographic quotas are met.

These are operating caps, not promises. The pilot determines the actual credits-per-record ratio.

## Run controls

Every run must have configurable caps:

- `MAX_SEARCH_QUERIES`
- `MAX_DOMAINS`
- `MAX_PAGES_PER_DOMAIN`
- `MAX_TOTAL_PAGES`
- `MAX_CONCURRENCY`
- `MAX_CREDITS`

On HTTP 429, pause that queue and retry with exponential backoff. Do not increase concurrency to overcome site or API limits.

Write a manifest containing:

- run ID;
- query and zone;
- requested and resolved URL;
- domain decision: accepted, excluded or duplicate;
- scrape status;
- robots-blocked status;
- timestamp;
- credits used; and
- extraction version.

## Outputs

Keep real practitioner data outside version control.

1. `verified_practitioners.csv` — the 200 reviewed records suitable for founder outreach.
2. `candidate_evidence.jsonl` — field-level source evidence and timestamps.
3. `needs_review.csv` — unresolved identity, taxonomy and location conflicts.
4. `rejected_candidates.csv` — rejection reason and source URL.
5. `crawl_manifest.jsonl` — reproducibility, errors and credit accounting.
6. `crawl_summary.md` — yield, coverage, missingness and QA results without unnecessary personal details.

Synthetic fixtures, schemas and code may be committed. Real crawl output must be stored in a gitignored private-data directory or an approved private data store.

## Acceptance criteria

The crawl is complete when:

- exactly 200 unique AHPRA-verified practitioners meet the record definition;
- the split is 100 physiotherapists and 100 psychologists;
- each geographic quota is met within a documented tolerance;
- 100% of records include practitioner name, profession, practice, Sydney suburb/postcode, primary source URL and scrape timestamp;
- 100% include AHPRA verification status and verification timestamp;
- every non-null funding, language, telehealth and capacity value has explicit source evidence;
- no record relies solely on a directory, social network, review site or search snippet;
- no patient information, testimonials or reviews are retained;
- all duplicates and ambiguous identities have been reviewed; and
- all 200 records remain inactive until practitioner confirmation.

## Decisions still needed before the full run

1. Confirm that Greater Sydney is the intended boundary.
2. Confirm the 100 physiotherapist / 100 psychologist split.
3. Supply the 15 GP practice postcodes so geographic quotas can be weighted toward real referral catchments.
4. Approve the controlled funding-type list.
5. Approve the broad referral-category list.
6. Decide where private crawl output will be stored and reviewed.

## Firecrawl references

- Search API: <https://docs.firecrawl.dev/api-reference/endpoint/search>
- Map API: <https://docs.firecrawl.dev/api-reference/endpoint/map>
- Batch Scrape API: <https://docs.firecrawl.dev/api-reference/endpoint/batch-scrape>
- Batch status: <https://docs.firecrawl.dev/api-reference/endpoint/batch-scrape-get>
- Batch errors and robots-blocked URLs: <https://docs.firecrawl.dev/api-reference/endpoint/batch-scrape-get-errors>
- Structured extraction selection: <https://docs.firecrawl.dev/developer-guides/usage-guides/choosing-the-data-extractor>
