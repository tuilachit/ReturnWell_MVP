import assert from "node:assert/strict";
import test from "node:test";
import { referralStatusLabel } from "../app/lib/referral-status.ts";
test("coordination states never imply that acceptance books an appointment", () => {
  assert.equal(referralStatusLabel("sent"), "Awaiting response");
  assert.equal(referralStatusLabel("accepted"), "Accepted — arrange handover");
  assert.equal(referralStatusLabel("booked"), "Previously recorded as booked");
  assert.equal(referralStatusLabel("cancelled"), "Cancelled");
  assert.equal(referralStatusLabel("unknown"), "Status unavailable");
});
