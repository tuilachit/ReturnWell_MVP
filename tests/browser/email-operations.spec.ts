import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminBrowser } from "../helpers/admin-browser.mjs";
test("operator delivery view is read-only, bounded and accessible", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated stack");
  const { local } = await adminBrowser(page, { stepUp: false });
  const before = local.sql(
    "select coalesce(sum(attempts),0) from private.email_jobs",
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/admin/email");
  await expect(
    page.getByRole("heading", { name: "Email delivery", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh delivery status" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Refresh delivery status" }).click();
  await expect(
    page.getByRole("button", { name: "Refresh delivery status" }),
  ).toBeEnabled();
  expect(
    local.sql("select coalesce(sum(attempts),0) from private.email_jobs"),
  ).toBe(before);
  expect(
    await page
      .getByRole("button", { name: /force.resend|send email/i })
      .count(),
  ).toBe(0);
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("non-operator cannot open delivery diagnostics", async ({ page }) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated stack");
  await adminBrowser(page, { stepUp: false, operator: false });
  await page.goto("/admin/email");
  await expect(
    page.getByRole("heading", { name: /No workspace|Workspace unavailable/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Email delivery", exact: true }),
  ).toHaveCount(0);
});
