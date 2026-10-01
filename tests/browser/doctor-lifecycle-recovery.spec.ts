import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { doctorBrowser } from "../helpers/browser-context.mjs";
import { createReferral } from "../../app/lib/referrals";
async function fixture(page, options = {}) {
  const context = await doctorBrowser(page, options);
  const { doctor, organisationId, practitionerId, local } = context;
  const referral = await createReferral(
    doctor.client,
    {
      organisationId,
      organisationName: "Fictional Practice",
      displayName: "Fictional Doctor",
    },
    doctor.userId,
    {
      patientReference: "FICTIONAL-LIFECYCLE-RECOVERY",
      patientPostcode: "2000",
      profession: "physiotherapist",
      clinicalSummary: "Fictional recovery only.",
      fundingPath: "Medicare",
      appointmentFormat: "telehealth",
      languageOrAccess: "",
      selectionMode: "doctor",
      selectedPractitionerId: practitionerId,
      consentConfirmed: true,
    },
  );
  const cancel = async () =>
    expect(
      (
        await local.call(
          "manage-referral",
          {
            operation: "transition",
            action: "cancel",
            referralId: referral.id,
            expectedVersion: 0,
            reasonCode: "entered_in_error",
            note: "",
            handoverConfirmed: false,
            requestId: randomUUID(),
          },
          doctor.client,
        )
      ).status,
    ).toBe(200);
  return { ...context, referral, cancel };
}
test.beforeEach(() =>
  test.skip(
    !process.env.RW_LOCAL_STACK_DIR,
    "Requires isolated local Supabase",
  ),
);
test("replacement retries the original command after a committed RPC response is lost", async ({
  page,
}) => {
  const { referral, cancel, local } = await fixture(page, {
    loseRpcResponseOnceFor: "referral.replace",
  });
  await cancel();
  await page.goto("/referrals/" + referral.id);
  await page
    .getByRole("button", { name: "Start replacement referral", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Check and retry change", exact: true }),
  ).toBeVisible();
  await page.route("**/rest/v1/referrals?*", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: '{"message":"Fictional read unavailable"}',
    }),
  );
  const failedRead = page.waitForResponse(
    (response) =>
      response.url().includes("/rest/v1/referrals?") &&
      response.status() === 400,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await failedRead;
  await expect(
    page.getByText(
      "We could not refresh the referral workspace. Your current work is retained. Try refreshing again.",
    ),
  ).toBeVisible();
  await page.unroute("**/rest/v1/referrals?*");
  await page
    .getByRole("button", { name: "Check and retry change", exact: true })
    .click();
  await expect(page.getByPlaceholder("e.g. Practice record ID")).toHaveValue(
    "FICTIONAL-LIFECYCLE-RECOVERY",
  );
  expect(
    local.sql(
      `select count(*) from public.referral_drafts where supersedes_referral_id='${referral.id}'`,
    ),
  ).toBe("1");
});
test("doctor lifecycle edits survive failed detail and list refreshes but not revoked access", async ({
  page,
}) => {
  const { referral, local, doctor, organisationId } = await fixture(page);
  await page.goto("/referrals/" + referral.id);
  await page
    .getByRole("button", { name: "Cancel referral", exact: true })
    .click();
  const note = page.getByRole("textbox", {
    name: "Coordination note (optional)",
  });
  await note.fill("Fictional note retained through interruption");
  const detailPattern = "**/rest/v1/referrals?*";
  await page.route(detailPattern, (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: '{"message":"Fictional read unavailable"}',
    }),
  );
  const read = page.waitForResponse(
    (response) =>
      response.url().includes("/rest/v1/referrals?") &&
      response.status() === 400,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await read;
  await expect(
    page.getByText(
      "We could not refresh the referral workspace. Your current work is retained. Try refreshing again.",
    ),
  ).toBeVisible();
  await expect(note).toHaveValue(
    "Fictional note retained through interruption",
  );
  await page.unroute(detailPattern);
  await page.route("**/functions/v1/manage-referral", (route) =>
    route.request().postDataJSON()?.operation === "list"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"code":"request_failed"}',
        })
      : route.fallback(),
  );
  const failedList = page.waitForResponse(
    (response) =>
      response.url().includes("/functions/v1/manage-referral") &&
      response.status() === 503,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await failedList;
  await expect(note).toHaveValue(
    "Fictional note retained through interruption",
  );
  await page
    .getByRole("button", { name: "New referral +", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Leave this referral action?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  local.sql(
    `update public.organisation_memberships set active=false where user_id='${doctor.userId}' and organisation_id='${organisationId}'`,
  );
  await page.unroute("**/functions/v1/manage-referral");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(note).not.toBeVisible();
});
test("navigation cannot replace an in-flight lifecycle command with another form", async ({
  page,
}) => {
  const { referral, cancel, releaseReplacement } = await fixture(page, {
    holdReplacementResponse: true,
  });
  await cancel();
  await page.goto("/referrals/" + referral.id);
  await page
    .getByRole("button", { name: "Start replacement referral", exact: true })
    .click();
  try {
    await page
      .getByRole("button", { name: "New referral +", exact: true })
      .click();
    await expect(
      page.getByText(
        "Resolve the pending referral action before leaving this referral.",
      ),
    ).toBeVisible();
    await expect(
      page.getByPlaceholder("e.g. Practice record ID"),
    ).not.toBeVisible();
  } finally {
    releaseReplacement();
  }
  await expect(page.getByPlaceholder("e.g. Practice record ID")).toHaveValue(
    "FICTIONAL-LIFECYCLE-RECOVERY",
  );
});
