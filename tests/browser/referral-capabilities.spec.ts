import { test, expect } from "@playwright/test";
import { doctorBrowser } from "../helpers/browser-context.mjs";
test("a doctor keeps explicit capabilities in a saved draft and cannot reuse an incompatible selection", async ({
  page,
}) => {
  test.skip(
    !process.env.RW_LOCAL_STACK_DIR,
    "Requires isolated local Supabase.",
  );
  const { clinic } = await doctorBrowser(page);
  await page.goto("/");
  await page.getByRole("button", { name: "New referral", exact: true }).click();
  await page
    .getByPlaceholder("e.g. Practice record ID")
    .fill("FICTIONAL-CAPABILITIES");
  await page.getByPlaceholder("e.g. 2000").fill("2000");
  await page
    .getByPlaceholder("Describe the need, goals and relevant context…")
    .fill("Fictional capability check.");
  await page.getByRole("button", { name: "Find practitioners" }).click();
  await page.getByRole("radio", { name: new RegExp(clinic) }).check();
  await page.getByRole("button", { name: "Back", exact: true }).last().click();
  await page
    .getByRole("checkbox", { name: "Persistent pain", exact: true })
    .check();
  await page
    .getByRole("combobox", { name: /Age group requirement/ })
    .selectOption("adult");
  await page.getByRole("button", { name: "Find practitioners" }).click();
  await expect(
    page.getByText("No eligible practitioners found", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review referral", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Back", exact: true }).last().click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("Draft saved privately. No email was sent."),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "New referral", exact: true }).click();
  await page.getByLabel("Resume a saved draft").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Load draft", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Persistent pain", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("combobox", { name: /Age group requirement/ }),
  ).toHaveValue("adult");
});
