import { test, expect } from "@playwright/test";
import { doctorBrowser } from "../helpers/browser-context.mjs";
import { directoryScaleFixtureSql } from "../helpers/directory-scale-fixture.mjs";
test("directory has 5000 fictional profiles but each browser response and page stays bounded", async ({
  page,
}) => {
  test.skip(
    !process.env.RW_LOCAL_STACK_DIR,
    "Requires isolated local Supabase.",
  );
  test.setTimeout(120000);
  const { local, doctor, owner, organisationId } = await doctorBrowser(page);
  const tag = "SCALE-" + organisationId.toUpperCase();
  local.sql(
    directoryScaleFixtureSql({
      ownerId: owner.userId,
      reviewerId: doctor.userId,
      tag,
    }),
  );
  try {
    const pageSizes: number[] = [];
    page.on("response", (response) => {
      if (response.url().endsWith("/functions/v1/search-practitioners"))
        void response
          .json()
          .then((body) => {
            if (body.items) pageSizes.push(body.items.length);
          })
          .catch(() => {});
    });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Practitioners", exact: true })
      .click();
    await page.getByRole("textbox", { name: "Search practitioners" }).fill(tag);
    await expect(
      page.getByText("2500 available", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start referral", exact: true }),
    ).toHaveCount(25);
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "First page", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Start referral", exact: true }),
    ).toHaveCount(25);
    await page
      .getByRole("button", {
        name: "Telehealth-only options (2500)",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: "First page", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Start referral", exact: true }),
    ).toHaveCount(25);
    await expect.poll(() => pageSizes.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...pageSizes)).toBeLessThanOrEqual(50);
  } finally {
    // Retain fictional audit data, but never affect another test's directory.
    local.sql(
      "update public.practitioners set lifecycle_status='inactive' where practice_name='" +
        tag +
        "' and contact_email='fixture@example.test';",
    );
  }
});
