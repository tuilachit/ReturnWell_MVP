import { test, expect } from "@playwright/test";
import { doctorBrowser } from "../helpers/browser-context.mjs";
test("a real local doctor saves and reloads a private draft without sending mail", async ({
  page,
}) => {
  test.skip(
    !process.env.RW_LOCAL_STACK_DIR,
    "Requires the explicitly isolated Supabase stack.",
  );
  const { local, doctor } = await doctorBrowser(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Referrals", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New referral", exact: true }).click();
  await page
    .getByPlaceholder("e.g. Practice record ID")
    .fill("DRAFT-FICTIONAL");
  await page
    .getByPlaceholder("Describe the need, goals and relevant context…")
    .fill("Fictional saved draft summary");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("Draft saved privately. No email was sent."),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "New referral", exact: true }).click();
  await expect(
    page.getByLabel("Resume a saved draft").locator("option"),
  ).toHaveCount(2);
  await page.getByLabel("Resume a saved draft").focus();
  await page.getByLabel("Resume a saved draft").selectOption({ index: 1 });
  const dialog = page.getByRole("dialog", { name: "Load saved draft?" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel("Resume a saved draft")).toBeFocused();
  await page.getByLabel("Resume a saved draft").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Load draft", exact: true }).click();
  await expect(page.getByPlaceholder("e.g. Practice record ID")).toHaveValue(
    "DRAFT-FICTIONAL",
  );
  await expect(
    page.getByPlaceholder("Describe the need, goals and relevant context…"),
  ).toHaveValue("Fictional saved draft summary");
  expect(
    local.sql(
      `select count(*) from public.referrals where created_by='${doctor.userId}'`,
    ),
  ).toBe("0");
  expect(
    await page.evaluate(() =>
      Object.entries(localStorage).some(
        ([k, v]) =>
          !k.startsWith("sb-") && v.includes("Fictional saved draft summary"),
      ),
    ),
  ).toBe(false);
});
test("lost finalisation response retries the same draft and queues exactly one notification", async ({
  page,
}) => {
  test.skip(
    !process.env.RW_LOCAL_STACK_DIR,
    "Requires the explicitly isolated Supabase stack.",
  );
  const { local, doctor, clinic } = await doctorBrowser(page, {
    dropFinalResponseOnce: true,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New referral", exact: true }).click();
  await page
    .getByPlaceholder("e.g. Practice record ID")
    .fill("SUBMIT-FICTIONAL");
  await page.getByPlaceholder("e.g. 2000").fill("2000");
  await page
    .getByPlaceholder("Describe the need, goals and relevant context…")
    .fill("Fictional browser referral.");
  await page.getByRole("button", { name: "Find practitioners" }).click();
  await page.getByRole("radio", { name: new RegExp(clinic) }).check();
  await page.getByRole("button", { name: "Review referral" }).click();
  await page
    .getByRole("checkbox", {
      name: "I confirm the patient has consented and the information is accurate.",
    })
    .check();
  await page
    .getByRole("button", { name: "Record referral", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Check and retry", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Check and retry", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Referral recorded", level: 1 }),
  ).toBeVisible();
  expect(
    local.sql(
      `select count(*) from public.referrals where created_by='${doctor.userId}'`,
    ),
  ).toBe("1");
  expect(
    local.sql(
      `select count(*) from public.notification_outbox o join public.referrals r on r.id=o.referral_id where r.created_by='${doctor.userId}'`,
    ),
  ).toBe("1");
});
