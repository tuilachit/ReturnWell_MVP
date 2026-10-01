import { test, expect } from "@playwright/test";
import { doctorBrowser } from "../helpers/browser-context.mjs";
test("practitioner proposes changes while their approved profile remains unchanged", async ({
  page,
}) => {
  test.skip(
    !process.env.RW_LOCAL_STACK_DIR,
    "Requires isolated Supabase stack.",
  );
  const { local, practitionerId, clinic } = await doctorBrowser(page, {
    actor: "practitioner",
  });
  await page.goto("/practitioner");
  await page.getByText("Your approved profile", { exact: true }).click();
  await page.getByRole("button", { name: "Update reviewed profile" }).click();
  await page
    .getByRole("button", { name: "Start profile update", exact: true })
    .click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByLabel("Practice name", { exact: true })).toHaveValue(
    clinic,
  );
  await page
    .getByLabel("Practice name", { exact: true })
    .fill("Proposed Fictional Practice");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("saved");
  expect(
    local.sql(
      `select practice_name from public.practitioners where id='${practitionerId}'`,
    ),
  ).toBe(clinic);
  expect(
    local.sql(
      `select private.practitioner_is_eligible('${practitionerId}','physiotherapist',now())`,
    ),
  ).toBe("f");
  await page.reload();
  await expect(page.getByLabel("Practice name", { exact: true })).toHaveValue(
    "Proposed Fictional Practice",
  );
});
