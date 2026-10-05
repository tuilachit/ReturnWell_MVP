import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const config = readFileSync(
  new URL("../supabase/config.toml", import.meta.url),
  "utf8",
);
const section = (name) =>
  config.split(`[${name}]\n`)[1]?.split(/^\[/m)[0] ?? "";

test("two-role self-entry permits email signup but retains confirmation and no anonymous/SMS signup", () => {
  assert.match(section("auth"), /^enable_signup = true$/m);
  assert.match(section("auth.email"), /^enable_signup = true$/m);
  assert.match(section("auth.email"), /^enable_confirmations = true$/m);
  assert.match(section("auth"), /^enable_anonymous_sign_ins = false$/m);
  assert.match(section("auth.sms"), /^enable_signup = false$/m);
});
