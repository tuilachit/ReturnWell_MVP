# Geography source gate

Status on 2026-10-02: **not enabled**. No approved postcode reference dataset,
licence, edition or redistribution permission has been supplied for this release.
No source was downloaded or imported, and no paid maps account was created.

Live directory coordinates/distances remain unknown. In-person browsing by
reviewed suburb/postcode remains available; radius filtering must stay disabled.
Telehealth ranking does not use patient distance. Synthetic distances in unit
fixtures do not establish real-world geographical coverage.

## Implementation on `codex/location-matching`

The local implementation now supports authenticated postcode lookup, explicit
suburb confirmation, nearest distance across all approved locations, separate
unknown/remote groups, optional radius and distance/name/ID pagination. Search
preferences are retained in private referral drafts, not patient coordinates.

Precision is `suburb_reference`: a straight-line spherical approximation between
reference points, NOT exact patient/practice locations or travel distance. The
UI names the source/version and never auto-selects a suburb for a postcode.

Real-data activation remains blocked; implementation tests are not geographic
coverage validation. No hosted migration or deployment was performed here.

## Candidate source, pending approval

[GeoNames postal data](https://download.geonames.org/export/zip/) offers a free
AU export and [CC BY attribution terms](https://download.geonames.org/export/zip/readme.txt).
It is not Australia Post address validation. Coordinates may be estimated;
`suburb_reference` deliberately does not claim a true centroid. Approval of this
source and an update owner is still required. No source download was performed.

Before activation record the approved licence/storage rights, edition/date,
original file SHA256, NSW row and unique-postcode counts, missing coordinates,
duplicate/conflict review and operator responsible for refreshes. Do not convert
an unmatched practice address into a guessed postcode point.

## Import and rollback runbook

1. Apply `20261001222515_location_matching.sql` to an explicitly approved target
   using the normal migration process. It contains schema/functions only, no
   reference rows, and does not enable distance by itself.
2. Prepare reviewed JSON (all NSW rows; preserve four-digit postcode strings):

```json
{
  "source": {
    "version": "operator-approved-edition",
    "url": "https://source.example/dataset",
    "license": "Approved licence and version",
    "attribution": "Approved attribution text",
    "sha256": "64-lowercase-hex-characters-of-original-source-file",
    "publishedAt": "2026-10-01"
  },
  "localities": [
    {"state":"NSW","postcode":"2000","suburb":"Fictional example","latitude":null,"longitude":null}
  ]
}
```

3. `node scripts/import-geography.mjs approved-reference.json > reviewed-import.sql`
   only compiles SQL. Validate the full source before executing it. It rejects
   duplicates, partial/malformed coordinates, non-NSW records and missing metadata.
   No network access or credentials are used by this compiler.
4. Review and execute the generated transaction with operator database authority.
   Ordinary app/service clients cannot install or activate editions. All rows must
   pass before activation. Reimporting identical content is idempotent; changing
   an existing version fails. Keep original files and validation evidence private.
5. Deploy `search-practitioners` and the frontend together with the database
   release; test real authenticated postcode lookup, source labels, multiple
   locations, radius and unknown groups before announcing availability.
6. Roll back geography only with `select private.activate_geography('previous-edition');`
   in an operator transaction, or disable it with `delete from private.geography_active;`.
   Keep prior editions for rollback. Changed editions invalidate pagination;
   users return to the first page. Never delete a source still in use.

`private.install_geography` is transactional, edition-immutable and inaccessible
to anon/authenticated/service_role. Private reference tables are RLS-enabled;
the existing authorised directory endpoint exposes only one postcode's labels,
source metadata and bounded eligible projections, never the full dataset.
