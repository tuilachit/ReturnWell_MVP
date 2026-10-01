import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { adminBrowser } from "../helpers/admin-browser.mjs";
test("operator creates practice, reviews contact and cannot remove last owner", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated stack");
  const { local } = await adminBrowser(page);
  const owner = await local.verifiedFixtureUser(
    `practice-owner-${randomUUID()}@example.test`,
  );
  const name = `Fictional Reviewed Practice ${randomUUID().slice(0, 8)}`;
  await page.goto("/admin/practices");
  await page.getByRole("button", { name: "New practice", exact: true }).click();
  await page.getByLabel("Practice name", { exact: true }).fill(name);
  await page
    .getByLabel("Verified owner account ID", { exact: true })
    .fill(owner.userId);
  await page
    .getByLabel("Independent evidence reference", { exact: true })
    .fill("Fictional reviewed owner evidence");
  await page
    .getByRole("button", { name: "Create practice", exact: true })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByLabel("Work phone", { exact: true }).fill("02 1234 5678");
  await page
    .getByLabel("Secure handover instructions", { exact: true })
    .fill("Call the practice for the approved secure channel.");
  await page
    .getByLabel("Contact evidence reference", { exact: true })
    .fill("Independent callback completed");
  await page
    .getByRole("button", { name: "Save reviewed contact", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Reviewed contact saved",
  );
  await page.reload();
  await expect(page.getByLabel("Work phone", { exact: true })).toHaveValue(
    "02 1234 5678",
  );
  await page
    .getByRole("button", { name: "Remove access", exact: true })
    .click();
  await page
    .getByLabel("Reason for removal", { exact: true })
    .fill("Fictional removal test");
  await expect(
    page.getByRole("button", { name: "New practice", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Work phone", { exact: true })).toBeDisabled();
  await page
    .getByRole("button", { name: "Review removal", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove access", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Another independently reviewed owner",
  );
  expect(
    local.sql(
      `select count(*) from public.organisation_memberships where user_id='${owner.userId}' and active`,
    ),
  ).toBe("1");
});
