import assert from "node:assert/strict";
import test from "node:test";
import { searchPractitioners, listReferralPage, lookupLocalities } from "../app/lib/directory.ts";
test('postcode lookup and ranking send locality identity, never coordinates or patient notes', async () => {
  const calls = [];
  const client = { functions: { invoke: async (name, { body }) => { calls.push({ name, body }); return { data: {}, error: null }; } } };
  await lookupLocalities(client, '2000');
  assert.deepEqual(calls[0].body, { lookup: true, postcode: '2000' });
  await searchPractitioners(client, { postcode: '2000', localityId: 'NSW:2000:test', radiusKm: 10, distanceGroup: 'local', latitude: -33, clinicalSummary: 'private' });
  assert.equal(calls[1].body.localityId, 'NSW:2000:test');
  assert.equal(calls[1].body.radiusKm, 10);
  assert.equal(Object.hasOwn(calls[1].body, 'latitude'), false);
  assert.equal(Object.hasOwn(calls[1].body, 'clinicalSummary'), false);
});
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
