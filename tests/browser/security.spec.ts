import { test, expect } from "@playwright/test";
import { adminBrowser } from "../helpers/admin-browser.mjs";
import { totp } from "../helpers/mfa.mjs";
test("operator enrolls a real authenticator; AAL1 cannot approve and AAL2 reaches current role checks", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated stack");
  const { local, account } = await adminBrowser(page, { stepUp: false });
  const denied = await local.call(
    "review-practitioner",
    { operation: "decide" },
    account.client,
  );
  expect(denied.status).toBe(403);
  expect(denied.body.code).toBe("step_up_required");
  await page.goto("/security");
  await expect(
    page.getByRole("heading", { name: "Account security", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Set up authenticator", exact: true })
    .click();
  const secret = await page
    .getByLabel("Setup key", { exact: true })
    .inputValue();
  await page
    .getByLabel("Authenticator code", { exact: true })
    .fill(totp(secret));
  await page
    .getByRole("button", { name: "Verify authenticator", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Verified for privileged actions",
  );
  await page.reload();
  await expect(page.getByRole("status")).toContainText(
    "Verified for privileged actions",
  );
  await expect(page.getByRole("link", { name: "Practice administration", exact: true })).toHaveCount(0);
  // Customer/security navigation does not expose administration. Staff use
  // the explicit entry point, still checked against current backend authority.
  await page.goto('/admin/practices');
  await expect(
    page.getByRole("heading", { name: "Practice administration", exact: true }),
  ).toBeVisible();
});
