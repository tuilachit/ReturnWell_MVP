import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { doctorBrowser } from "../helpers/browser-context.mjs";
import { createReferral } from "../../app/lib/referrals";
async function referral(f, reference) {
  return createReferral(
    f.doctor.client,
    {
      organisationId: f.organisationId,
      organisationName: "Fictional Practice",
      displayName: "Fictional Doctor",
    },
    f.doctor.userId,
    {
      patientReference: reference,
      patientPostcode: "2000",
      profession: "physiotherapist",
      clinicalSummary:
        "FICTIONAL CLINICAL CONTENT " + "long content ".repeat(90),
      fundingPath: "Medicare",
      appointmentFormat: "telehealth",
      languageOrAccess: "",
      selectionMode: "doctor",
      selectedPractitionerId: f.practitionerId,
      consentConfirmed: true,
    },
  );
}
test("practitioner list is bounded metadata and cannot be read by an unrelated actor", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated stack");
  const f = await doctorBrowser(page, { actor: "practitioner" });
  for (let n = 0; n < 26; n++) await referral(f, `FICTIONAL-INBOX-${n}`);
  const first = await f.local.call(
    "manage-referral",
    {
      operation: "inbox.list",
      practitionerId: f.practitionerId,
      status: "sent",
      limit: 25,
    },
    f.owner.client,
  );
  expect(first.status).toBe(200);
  expect(first.body.items).toHaveLength(25);
  expect(first.body.total).toBe(26);
  expect(JSON.stringify(first.body)).not.toMatch(
    /clinical_summary|FICTIONAL CLINICAL|access_notes/,
  );
  const second = await f.local.call(
    "manage-referral",
    {
      operation: "inbox.list",
      practitionerId: f.practitionerId,
      status: "sent",
      limit: 25,
      cursor: first.body.nextCursor,
    },
    f.owner.client,
  );
  expect(second.body.items).toHaveLength(1);
  expect(first.body.items.map((r) => r.id)).not.toContain(
    second.body.items[0].id,
  );
  expect(
    (
      await f.local.call(
        "manage-referral",
        { operation: "inbox.list", practitionerId: f.practitionerId },
        f.doctor.client,
      )
    ).status,
  ).toBe(403);
  await page.goto("/practitioner");
  await expect(
    page.getByText("26 awaiting response referrals", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next inbox page" }).click();
  await expect(
    page.getByRole("button", { name: /RW-.*FICTIONAL-INBOX/ }),
  ).toHaveCount(1);
  f.local.sql(
    `update public.practitioner_users set active=false,revoked_at=now() where user_id='${f.owner.userId}' and practitioner_id='${f.practitionerId}'`,
  );
  expect(
    (
      await f.local.call(
        "manage-referral",
        { operation: "inbox.list", practitionerId: f.practitionerId },
        f.owner.client,
      )
    ).status,
  ).toBe(403);
});
test("lost practitioner response retries the original command after focus without duplicating the decision", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated stack");
  const f = await doctorBrowser(page, {
    actor: "practitioner",
    dropPractitionerResponseOnce: true,
  });
  const ref = await referral(f, "FICTIONAL-RESPONSE");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/referrals/" + ref.id);
  await page
    .getByRole("button", { name: "Decline referral", exact: true })
    .click();
  await page.getByLabel("Reason for declining").selectOption("capacity");
  await page
    .getByLabel("Note to the referring practice (optional)")
    .fill("Fictional reason");
  await page
    .getByRole("button", { name: "Confirm decline", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Check and retry response" }),
  ).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByRole("button", { name: "Check and retry response" }).click();
  await expect(page.getByRole("status")).toContainText("Response saved");
  expect(
    f.local.sql(
      `select count(*) from public.referral_events where referral_id='${ref.id}' and event_type='declined'`,
    ),
  ).toBe("1");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
});
test("decline edits survive a failed refresh but cannot silently adopt a newer version", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated stack");
  const f = await doctorBrowser(page, { actor: "practitioner" });
  const ref = await referral(f, "FICTIONAL-VERSION");
  await page.goto("/referrals/" + ref.id);
  await page
    .getByRole("button", { name: "Decline referral", exact: true })
    .click();
  await page.getByLabel("Reason for declining").selectOption("capacity");
  await page
    .getByLabel("Note to the referring practice (optional)")
    .fill("Keep this edit");
  await page.route("**/rest/v1/referrals?**", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: '{"message":"Fictional unavailable read"}',
    }),
  );
  await page
    .getByRole("button", { name: "Refresh referrals", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("unavailable");
  await expect(
    page.getByLabel("Note to the referring practice (optional)"),
  ).toHaveValue("Keep this edit");
  await page.unroute("**/rest/v1/referrals?**");
  await f.local.call(
    "respond-to-referral",
    {
      referralId: ref.id,
      expectedVersion: 0,
      decision: "accepted",
      requestId: randomUUID(),
    },
    f.owner.client,
  );
  await page
    .getByRole("button", { name: "Confirm decline", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("changed");
  expect(
    f.local.sql(
      `select count(*) from public.referral_events where referral_id='${ref.id}' and event_type='declined'`,
    ),
  ).toBe("0");
});
