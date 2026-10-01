# Geography source gate

Status on 2026-10-02: **NSW reference edition activated**, following explicit
user approval of GeoNames free AU postal data. No paid maps account or external
patient-location request is used. This does not approve practitioner profiles.

Edition: `geonames-nsw-2026-10-01-a7de4b2a61b8-accuracy46`.
Archive SHA256: `a7de4b2a61b81bd5fd7dc6bc166e0c0f241fb7b813419bea46dbdd579fe3b9b2`.
Source Last-Modified: 2026-10-01 02:14:16 UTC; archive size 271,091 bytes.
5,592 unique NSW postcode/locality pairs across 922 postcodes, no duplicate normalized keys.
4,525 accuracy-4 reference points; 1,067 retained with unknown coordinates
(72 accuracy-1, 992 undocumented accuracy-3, three unspecified). Only documented
accuracy 4/6 points may be used. Do not upgrade unknown rows to guessed points.
Other AU states are excluded. These are reference localities, not practitioners.

## Implementation on `codex/location-matching`

The local implementation now supports authenticated postcode lookup, explicit
suburb confirmation, nearest distance across all approved locations, separate
unknown/remote groups, optional radius and distance/name/ID pagination. Search
preferences are retained in private referral drafts, not patient coordinates.

Precision is `suburb_reference`: a straight-line spherical approximation between
reference points, NOT exact patient/practice locations or travel distance. The
UI names the source/version and never auto-selects a suburb for a postcode.

The schema was deployed in the preceding hosted repair. This edition is now
imported atomically through `private.install_geography`. No existing practitioner
coordinates were manufactured. Live directory matches still require approved
profiles and their separately reviewed locations.

## Approved source and limitations

[GeoNames postal data](https://download.geonames.org/export/zip/) offers a free
AU export and [CC BY attribution terms](https://download.geonames.org/export/zip/readme.txt).
It is not Australia Post address validation. Coordinates are approximate;
`suburb_reference` deliberately does not claim a true centroid. Approval of this
source was given for this import. A continuing refresh owner remains to be named.

The postal README states CC BY 4.0 but contains an old /by/3.0 hyperlink;
the current [official About page](https://www.geonames.org/about.html) explicitly
links CC BY 4.0. Preserve the README with each archive and retain attribution.
No broader licensing warranty is implied. The active metadata contains the
original source URL, attribution, licence, date and original/canonical checksums.

Prepare a future edition with `node scripts/prepare-geonames.mjs AU.zip
YYYY-MM-DD output.json`, using the observed source publication date. The command
never downloads or activates anything and refuses to overwrite an output file.
Review postcode counts, coordinate exclusions and upstream terms on every import.

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
