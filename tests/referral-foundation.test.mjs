import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);

async function readFoundationMigration() {
  const files = await readdir(migrationDirectory);
  const filenames = files.filter((file) => file.endsWith(".sql")).sort();
  assert.ok(filenames.length > 0, "referral foundation migration must exist");
  return (await Promise.all(
    filenames.map((filename) => readFile(new URL(filename, migrationDirectory), "utf8")),
  )).join("\n");
}

test("creates the referral records required by the GP and practitioner workflows", async () => {
  const sql = await readFoundationMigration();
  for (const table of [
    "profiles",
    "organisations",
    "organisation_memberships",
    "practitioners",
    "practitioner_locations",
    "practitioner_users",
    "referrals",
    "referral_events",
    "communication_preferences",
    "notification_outbox",
    "email_delivery_events",
  ]) {
    assert.match(sql, new RegExp(`create table public\\.${table}\\b`, "i"));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
});

test("scopes exposed clinical records to the signed-in user and their organisation", async () => {
  const sql = await readFoundationMigration();
  assert.match(sql, /\(select auth\.uid\(\)\)/i);
  assert.match(sql, /organisation_memberships[\s\S]*organisation_id[\s\S]*user_id/i);
  assert.match(sql, /create policy referrals_select_organisation_member/i);
  assert.match(sql, /create policy referrals_insert_organisation_member/i);
  assert.doesNotMatch(sql, /user_metadata/i);
  assert.match(sql, /revoke all on public\.notification_outbox from anon, authenticated/i);
  assert.match(sql, /revoke all on public\.email_delivery_events from anon, authenticated/i);
});

test("exposes only active practitioners with current registration and provider confirmation", async () => {
  const sql = await readFoundationMigration();
  assert.match(sql, /create view public\.verified_practitioners[\s\S]*security_invoker\s*=\s*true/i);
  assert.match(sql, /lifecycle_status\s*=\s*'active'/i);
  assert.match(sql, /ahpra_verification_status\s*=\s*'verified'/i);
  assert.match(sql, /provider_confirmation_status\s*=\s*'confirmed'/i);
  assert.match(sql, /accepting_new_referrals\s+is\s+true/i);
});

test("indexes tenant, foreign-key, status and pending-outbox access paths", async () => {
  const sql = await readFoundationMigration();
  for (const index of [
    "organisation_memberships_user_organisation_idx",
    "practitioner_users_user_practitioner_idx",
    "referrals_organisation_status_created_idx",
    "referral_events_referral_created_idx",
    "notification_outbox_pending_idx",
    "organisations_created_by_idx",
  ]) {
    assert.match(sql, new RegExp(`create (?:unique )?index ${index}\\b`, "i"));
  }
});

test("removes API execution rights from Supabase's automatic RLS event trigger", async () => {
  const sql = await readFoundationMigration();
  assert.match(
    sql,
    /revoke execute on function public\.rls_auto_enable\(\) from public, anon, authenticated/i,
  );
});
