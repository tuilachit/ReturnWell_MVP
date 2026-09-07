# Private research tooling — source only

This folder preserves the earlier ReturnWell Sydney candidate-research code and
planning document. It is separate from the GP referral app at the repository root.
The original working scripts remain in the parent local workspace; this is a
source snapshot for the initial repository upload, with lint-only cleanup of an
unused import and redundant quote escapes.

No real practitioner dataset, real-source validation fixtures, crawl output,
credentials or provider responses are included. The scripts resolve their local
`.env.local` and `private-data/` paths relative to this folder; both are ignored
by Git. Never put generated records in the app's `public/` directory.

The offline library tests use inline test records:

```sh
node --test research/scripts/crawl/crawl-lib.test.mjs
```

The crawler is not run by the app build or tests. Running it separately makes
external Firecrawl requests and may consume credits. Do not run it without
explicit approval, a current source/data-use review, and private output storage.
Candidate records remain unverified and must not become a public directory or
an automated outreach list.
