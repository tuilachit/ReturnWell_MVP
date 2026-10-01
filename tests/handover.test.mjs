import assert from "node:assert/strict";
import test from "node:test";
const api = await import("../app/lib/handover.ts").catch(() => ({}));
test("accepted handover says arrange externally, never booked or automatically completed", () => {
  assert.equal(typeof api.handoverHeading, "function");
  assert.equal(api.handoverHeading("accepted"), "Arrange external handover");
  for (const status of [
    "awaiting_onboarding",
    "sent",
    "declined",
    "cancelled",
    "closed",
    "booked",
  ]) {
    assert.ok(api.handoverHeading(status));
    assert.notEqual(api.handoverHeading(status), "Arrange external handover");
  }
});
test("handover request contains only a referral ID; phone and HTTPS links cannot carry patient message text", async () => {
  assert.equal(typeof api.getReferralHandover, "function");
  let body;
  const client = {
    functions: {
      invoke: async (name, request) => {
        assert.equal(name, "manage-referral");
        body = request.body;
        return {
          data: { status: "accepted", contactPhone: null, reviewedAt: null },
          error: null,
        };
      },
    },
  };
  const result = await api.getReferralHandover(client, "opaque-referral-id");
  assert.deepEqual(body, {
    operation: "handover.read",
    referralId: "opaque-referral-id",
  });
  assert.equal(result.contactPhone, null);
  assert.equal(api.handoverPhoneHref("+61 (2) 1234 5678"), "tel:+61212345678");
  assert.equal(api.handoverPhoneHref("javascript:alert(1)"), null);
  assert.equal(api.handoverPhoneHref("()-----"), null);
  assert.equal(api.handoverPhoneHref("02 1234 5678?body=PATIENT"), null);
  const parts = api.handoverInstructionParts(
    "Use https://secure.example.test/handover then email mailto:team@example.test?body=PATIENT. Never run <script>alert(1)</script> or https://name:password@evil.test/.",
  );
  assert.deepEqual(
    parts.filter((p) => p.href).map((p) => p.href),
    ["https://secure.example.test/handover"],
  );
  assert.equal(
    parts.map((p) => p.text).join(""),
    "Use https://secure.example.test/handover then email mailto:team@example.test?body=PATIENT. Never run <script>alert(1)</script> or https://name:password@evil.test/.",
  );
});
