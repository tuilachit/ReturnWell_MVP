import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { doctorBrowser } from "../helpers/browser-context.mjs";
import { getProfession } from "../../app/lib/professions";
import AxeBuilder from "@axe-core/playwright";
async function application(page) {
  const fixture = await doctorBrowser(page, { actor: "practitioner" });
  const revision = await fixture.local.call(
    "practitioner-onboarding",
    {
      operation: "revision_start",
      practitionerId: fixture.practitionerId,
      requestId: randomUUID(),
    },
    fixture.owner.client,
  );
  expect(revision.status).toBe(200);
  return { ...fixture, applicationId: revision.body.id };
}
test("server-policy profession uses its professional-body label, not an AHPRA claim", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated stack");
  const { local, applicationId } = await application(page);
  local.sql(
    `update public.practitioner_applications set profile=jsonb_set(profile,'{profession}','"exercise_physiologist"') where id='${applicationId}'`,
  );
  await page.goto("/onboarding");
  await expect(
    page.getByLabel(getProfession("exercise_physiologist")!.credentialLabel, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Profession", { exact: true })).toHaveValue(
    "exercise_physiologist",
  );
});

for (const width of [375, 1440]) {
  test(`practitioner setup remains legible, accessible and draft-safe at ${width}px`, async ({
    page,
  }) => {
    test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated stack");
    await application(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.goto("/onboarding");
    await expect(
      page.getByLabel("Full professional name", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .getByLabel("Full professional name", { exact: true })
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(16);
    const findings = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      findings.violations
        .filter((v) => ["serious", "critical"].includes(v.impact || ""))
        .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
    await expect(
      page.getByRole("button", { name: "Submit for review", exact: true }),
    ).toBeDisabled();
    await page.screenshot({
      path: `outputs/recipient-profile-${width}.png`,
      fullPage: true,
    });
    await page
      .getByLabel("Practice name", { exact: true })
      .fill("Fictional design review practice");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Draft saved");
    await page.reload();
    await expect(page.getByLabel("Practice name", { exact: true })).toHaveValue(
      "Fictional design review practice",
    );
  });
}
test("changes-requested practitioner can save a partial draft and gets specific submission errors", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated stack");
  const { local, applicationId } = await application(page);
  local.sql(
    `update public.practitioner_applications set status='changes_requested',applicant_feedback='Please confirm your work location.',profile='{}' where id='${applicationId}'`,
  );
  await page.goto("/onboarding");
  await expect(
    page.getByText("Please confirm your work location.", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Full professional name", { exact: true })
    .fill("Fictional Partial Applicant");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Draft saved");
  await page.reload();
  await expect(
    page.getByLabel("Full professional name", { exact: true }),
  ).toHaveValue("Fictional Partial Applicant");
  await page
    .getByRole("checkbox", {
      name: "I confirm this profile is accurate.",
      exact: true,
    })
    .check();
  await page
    .getByRole("checkbox", { name: /I agree to receive referrals/ })
    .check();
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  await expect(
    page.getByText("Enter your practice name.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Practice name", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  expect(
    local.sql(
      `select status from public.practitioner_applications where id='${applicationId}'`,
    ),
  ).toBe("changes_requested");
});
test("conflicting saved version and changed notices retain the form and require fresh consent", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated stack");
  const { local, applicationId, runtime } = await application(page);
  await page.goto("/onboarding");
  await page
    .getByLabel("Practice name", { exact: true })
    .fill("Unsaved fictional practice");
  await page
    .getByRole("checkbox", {
      name: "I confirm this profile is accurate.",
      exact: true,
    })
    .check();
  await page
    .getByRole("checkbox", { name: /I agree to receive referrals/ })
    .check();
  local.sql(
    `update public.practitioner_applications set version=version+1,profile=jsonb_set(profile,'{practiceName}','"Saved by another session"') where id='${applicationId}'`,
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("record changed");
  await expect(page.getByLabel("Practice name", { exact: true })).toHaveValue(
    "Unsaved fictional practice",
  );
  runtime.env.TERMS_VERSION = "updated-local-test-terms";
  await page
    .getByText("Compare with the current saved version", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Load saved version", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /I agree to receive referrals/ }),
  ).not.toBeChecked();
  await expect(page.getByLabel("Practice name", { exact: true })).toHaveValue(
    "Unsaved fictional practice",
  );
  await expect(
    page.getByText("Saved by another session", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Use saved version as base", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Keep my form", exact: true })
    .click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Draft saved");
});
