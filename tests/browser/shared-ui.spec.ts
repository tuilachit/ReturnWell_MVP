import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const width of [320, 375, 768, 1024, 1440]) {
  test(`entry and empty workspace are accessible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/*", (route) =>
      ["localhost", "127.0.0.1"].includes(
        new URL(route.request().url()).hostname,
      )
        ? route.continue()
        : route.abort(),
    );
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Preview empty workspace" }),
    ).toBeEnabled();
    for (const preview of [false, true]) {
      if (preview)
        await page
          .getByRole("button", { name: "Preview empty workspace" })
          .click();
      if (preview)
        await expect(
          page.getByRole("heading", { name: "Referrals", exact: true }),
        ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        results.violations
          .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
          .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      ).toEqual([]);
    }
    await expect(
      page.getByText("Appointments booked", { exact: true }),
    ).toHaveCount(0);
  });
}
test("leaving an unsaved referral requires a keyboard-operable confirmation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preview empty workspace" }).click();
  await page.getByRole("button", { name: "New referral", exact: true }).click();
  await page
    .getByPlaceholder("e.g. Practice record ID")
    .fill("UNSAVED-FICTIONAL");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Leave this draft?" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("e.g. Practice record ID")).toHaveValue(
    "UNSAVED-FICTIONAL",
  );
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Discard unsaved changes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Referrals", exact: true }),
  ).toBeVisible();
});
test("mobile navigation hands keyboard focus to the discard dialog", async ({ page }) => {
  await page.setViewportSize({width:375,height:900});
  await page.goto("/");
  await page.getByRole("button",{name:"Preview empty workspace"}).click();
  await page.getByRole("button",{name:"New referral",exact:true}).click();
  await page.getByPlaceholder("e.g. Practice record ID").fill("MOBILE-DIRTY");
  await page.getByRole("button",{name:"Open navigation"}).click();
  await page.getByRole("navigation",{name:"Main navigation"}).getByRole("button",{name:/^Referrals/}).click();
  const dialog=page.getByRole("dialog",{name:"Leave this draft?"});
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button",{name:"Keep editing"}).focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button",{name:"Discard unsaved changes"})).toBeFocused();
});
test("oversized referral input can be corrected without entering uncertain submission", async ({page}) => {
  await page.goto("/");
  await page.getByRole("button",{name:"Preview empty workspace"}).click();
  await page.getByRole("button",{name:"New referral",exact:true}).click();
  await page.getByPlaceholder("e.g. Practice record ID").fill("X".repeat(121));
  await page.getByPlaceholder("e.g. 2000").fill("2000");
  await page.getByPlaceholder("Describe the need, goals and relevant context…").fill("Fictional context");
  await page.getByRole("button",{name:"Find practitioners"}).click();
  await expect(page.getByRole("alert")).toContainText("patientReference");
  await page.getByPlaceholder("e.g. Practice record ID").fill("CORRECTED");
  await page.getByRole("button",{name:"Find practitioners"}).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Check and retry"})).toHaveCount(0);
});
