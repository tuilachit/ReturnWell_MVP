import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { terminologySeed } from "../scripts/generate-terminology-seed.mjs";
test("SQL reference seed matches the browser and Deno shared catalogue", () => {
  const sql = readFileSync(
    new URL(
      "../supabase/migrations/20261001141755_matching_capabilities.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(
    sql
      .split("-- BEGIN GENERATED TERMS\n")[1]
      .split(";\n-- END GENERATED TERMS")[0],
    terminologySeed,
  );
});
