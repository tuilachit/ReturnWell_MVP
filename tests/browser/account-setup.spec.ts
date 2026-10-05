import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { doctorBrowser } from "../helpers/browser-context.mjs";
async function newAccount(page) {
  const f = await doctorBrowser(page, { seedSession: false });
  const account = await f.local.verifiedFixtureUser(
    `self-browser-${randomUUID()}@example.test`,
  );
  const {
    data: { session },
  } = await account.client.auth.getSession();
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: account.client.auth.storageKey, value: session },
  );
  return { ...f, account };
}
test("new doctor self-enters and opens only their own practice", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated stack");
  const f = await newAccount(page);
  await page.goto("/account/setup");
  await expect(
    page.getByRole("heading", {
      name: "Set up your ReturnWell account",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("radio", { name: "Doctor — send referrals", exact: true })
    .check();
  await page
    .getByLabel("Full professional name", { exact: true })
    .fill("Dr Fictional Self Entry");
  await page
    .getByLabel("Practice name", { exact: true })
    .fill("Fictional Self Entry Practice");
  await page
    .getByLabel("AHPRA registration number", { exact: true })
    .fill("MED-FICTIONAL");
  await page.getByRole("checkbox", { name: /I agree to the/ }).check();
  await page
    .getByRole("button", { name: "Create my workspace", exact: true })
    .click();
  await page.waitForURL("/");
  const result = await f.local.call("workspace-access", {}, f.account.client);
  expect(result.body.doctors).toHaveLength(1);
  expect(result.body.doctors[0].organisationId).not.toBe(f.organisationId);
  expect(result.body.operator).toBe(false);
});
test("new receiving practitioner enters their own profile, without becoming referral eligible", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated stack");
  const f = await newAccount(page);
  await page.goto("/account/setup");
  await page
    .getByRole("radio", {
      name: "Practitioner — receive referrals",
      exact: true,
    })
    .check();
  await page
    .getByLabel("Full professional name", { exact: true })
    .fill("Fictional Receiving Applicant");
  await page.getByRole("checkbox", { name: /I agree to the/ }).check();
  await page
    .getByRole("button", { name: "Start my practitioner profile", exact: true })
    .click();
  await page.waitForURL("/onboarding");
  await expect(
    page.getByLabel("Full professional name", { exact: true }),
  ).toHaveValue("Fictional Receiving Applicant");
  const result = await f.local.call("workspace-access", {}, f.account.client);
  expect(result.body.practitioners).toHaveLength(0);
  expect(result.body.applicationId).toBeTruthy();
});
