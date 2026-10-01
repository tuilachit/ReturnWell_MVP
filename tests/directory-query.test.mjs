import assert from "node:assert/strict";
import test from "node:test";
import { searchPractitioners, listReferralPage } from "../app/lib/directory.ts";
test("directory query sends structured needs and bounded pages without clinical text", async () => {
  const calls = [];
  const client = {
    functions: {
      invoke: async (name, { body }) => {
        calls.push({ name, body });
        return {
          data: {
            items: [],
            nextCursor: null,
            totalEligible: 0,
            groupCounts: { local: 0, unknown: 0, remote: 0 },
          },
          error: null,
        };
      },
    },
  };
  await searchPractitioners(client, {
    needs: {
      professionId: "physiotherapist",
      fundingId: "medicare",
      appointmentFormat: "either",
      requiredServiceIds: [],
    },
    distanceGroup: "unknown",
    limit: 5000,
    clinicalSummary: "Must not leave the client",
  });
  assert.equal(calls[0].name, "search-practitioners");
  assert.equal(calls[0].body.limit, 50);
  assert.equal(Object.hasOwn(calls[0].body, "clinicalSummary"), false);
  await listReferralPage(client, { organisationId: "org", limit: 0 });
  assert.equal(calls[1].body.limit, 1);
  assert.equal(calls[1].body.operation, "list");
});
