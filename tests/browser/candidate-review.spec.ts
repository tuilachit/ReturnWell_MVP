import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { doctorBrowser } from "../helpers/browser-context.mjs";
import { prepareCandidateBatch } from "../../scripts/candidates/normalise.mjs";
import { legacyCandidate } from "../fixtures/candidate-records.mjs";

async function adminBrowser(page, options = {}) {
  const fixture = await doctorBrowser(page, options);
  fixture.local.sql(
    `insert into private.platform_operators(user_id) values ('${fixture.doctor.userId}')`,
  );
  const identity = fixture.runtime.getUser;
  fixture.runtime.getUser = async (token) => {
    const user = await identity(token);
    return user ? { ...user, aal: "aal2" } : null;
  };
  const tag = randomUUID().slice(0, 8);
  const records = Array.from({ length: 51 }, (_, i) =>
    legacyCandidate({
      candidate_id: `${tag}-${i}`,
      display_name: `${tag} Fictional ${String(i).padStart(2, "0")}`,
      notes: '<img src=x onerror="window.pwned=true">',
    }),
  );
  const batch = prepareCandidateBatch([
    { label: tag, bytes: Buffer.from(JSON.stringify(records)) },
  ]);
  const { data, error } = await fixture.local.admin.rpc(
    "rw_import_candidate_batch",
    {
      p_actor: fixture.doctor.userId,
      p_manifest: batch.manifest,
      p_records: batch.records,
    },
  );
  if (error) throw Error(`Candidate fixture import failed: ${error.code}`);
  return { ...fixture, tag, batchId: data.batchId };
}
test("operator reviews paginated private evidence, not an active referral profile", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated stack");
  const f = await adminBrowser(page);
  await page.goto("/admin/candidates");
  await expect(
    page.getByRole("heading", { name: "Candidate review", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search candidates").fill(f.tag);
  await expect(page.getByText("51 candidates", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Review .*Fictional/ }),
  ).toHaveCount(25);
  await expect(
    page.getByText('<img src=x onerror="window.pwned=true">', { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Next candidates", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Next candidates", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Review .*Fictional/ }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: /Review .*Fictional/ }).click();
  await expect(
    page.getByText("Unverified research record — not available for referral.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByText("Original observed record", { exact: true }).click();
  await expect(page.getByText(/onerror=/).first()).toBeVisible();
  expect(await page.evaluate(() => Boolean(window["pwned"]))).toBe(false);
  for (const name of [
    "Send bulk invitations",
    "Activate practitioner",
    "Refer",
  ])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
});
test("doctor cannot read private candidate route", async ({ page }) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated stack");
  await doctorBrowser(page);
  await page.goto("/admin/candidates");
  await expect(
    page.getByRole("heading", { name: "No workspace is available here" }),
  ).toBeVisible();
  await expect(page.getByLabel("Search candidates")).toHaveCount(0);
});
test("lost disposition response locks the original payload and retries exactly once", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated stack");
  const f = await adminBrowser(page, {
    loseRpcResponseOnceFor: "candidate.dispose",
  });
  await page.goto("/admin/candidates");
  await page.getByLabel("Search candidates").fill(f.tag);
  await page
    .getByRole("button", { name: /Review .*Fictional/ })
    .first()
    .click();
  await page
    .getByLabel("Review disposition")
    .selectOption("reviewed_for_onboarding");
  await page.getByLabel("Reason", { exact: true }).fill("Fictional review");
  await page
    .getByLabel("Evidence reference", { exact: true })
    .fill("Fixture evidence");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("could not be confirmed");
  await expect(
    page.getByRole("textbox", { name: "Reason", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Retry same action", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Review saved");
  expect(
    f.local.sql(
      `select count(*) from private.candidate_review_events where actor_id='${f.doctor.userId}' and action='disposition:reviewed_for_onboarding'`,
    ),
  ).toBe("1");
});
test("version conflict and MFA retain edits; reload permits a new reviewed mutation", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated stack");
  const f = await adminBrowser(page);
  await page.goto("/admin/candidates");
  await page.getByLabel("Search candidates").fill(f.tag);
  await page
    .getByRole("button", { name: /Review .*Fictional/ })
    .first()
    .click();
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Retained fictional edit");
  f.local.sql(
    `update private.practitioner_candidates set version=version+1 where source_id='${f.tag}-0'`,
  );
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("record changed");
  await page
    .getByRole("button", {
      name: "Load current version (keep edits)",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Reason", exact: true }),
  ).toHaveValue("Retained fictional edit");
  const identity = f.runtime.getUser;
  f.runtime.getUser = async (token) => {
    const u = await identity(token);
    return u ? { ...u, aal: "aal1" } : null;
  };
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("authenticator");
  await expect(
    page.getByRole("textbox", { name: "Reason", exact: true }),
  ).toHaveValue("Retained fictional edit");
  f.runtime.getUser = identity;
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Review saved");
});
test("batch withdrawal needs explicit reason and confirmation; linked evidence can be corrected", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated stack");
  const f = await adminBrowser(page);
  const app = randomUUID();
  f.local.sql(
    `insert into public.practitioner_applications(id,user_id,revision_practitioner_id,status,terms_version,privacy_version) values ('${app}','${f.owner.userId}','${f.practitionerId}','submitted','test-terms-v1','test-privacy-v1')`,
  );
  await page.goto("/admin/candidates");
  await page.getByLabel("Search candidates").fill(f.tag);
  await page
    .getByRole("button", { name: /Review .*Fictional/ })
    .first()
    .click();
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Fictional source review");
  await page
    .getByLabel("Evidence reference", { exact: true })
    .fill("Fixture evidence");
  await page
    .getByLabel("Review disposition")
    .selectOption("reviewed_for_onboarding");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Review saved");
  await page.getByLabel("Application ID", { exact: true }).fill(app);
  await page
    .getByRole("button", { name: "Link application", exact: true })
    .click();
  await expect(
    page.getByText(`Linked application: ${app}`, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove application link", exact: true })
    .click();
  await expect(
    page.getByLabel("Application ID", { exact: true }),
  ).toBeVisible();
  expect(
    f.local.sql(
      `select status from public.practitioner_applications where id='${app}'`,
    ),
  ).toBe("submitted");
  await page
    .getByRole("button", { name: "Back to candidates", exact: true })
    .click();
  await page.getByText("Import batches", { exact: true }).click();
  // Digest, not internal batch ID, is the visible source identity.
  const digest = f.local.sql(
    `select digest from private.candidate_import_batches where id='${f.batchId}'`,
  );
  await page
    .locator("li")
    .filter({ hasText: digest })
    .getByRole("button", { name: "Review batch withdrawal", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm batch withdrawal", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Withdrawal reason").fill("Fictional withdrawal");
  await page
    .getByRole("checkbox", { name: /I understand the affected count/ })
    .check();
  await page
    .getByRole("button", { name: "Confirm batch withdrawal", exact: true })
    .click();
  await expect(page.getByText("0 candidates", { exact: true })).toBeVisible();
});
test("late private read cannot restore content after sign-out or role revocation", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated stack");
  const f = await adminBrowser(page);
  await page.goto("/admin/candidates");
  await page.getByLabel("Search candidates").fill(f.tag);
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const rpc = f.runtime.rpc;
  f.runtime.rpc = async (...args) => {
    const value = await rpc(...args);
    if (args[1] === "candidate.detail") await hold;
    return value;
  };
  await page
    .getByRole("button", { name: /Review .*Fictional/ })
    .first()
    .click();
  await expect(
    page.getByText("Loading research record…", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  release();
  await expect(
    page.getByRole("heading", { name: "Welcome to ReturnWell", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Unverified research record — not available for referral.", {
      exact: true,
    }),
  ).toHaveCount(0);
});
for (const width of [375, 1440])
  test(`candidate controls are accessible at ${width}px`, async ({ page }) => {
    test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated stack");
    const f = await adminBrowser(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/admin/candidates");
    await page.getByLabel("Search candidates").fill(f.tag);
    await page
      .getByRole("button", { name: /Review .*Fictional/ })
      .first()
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Reason", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const findings = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      findings.violations
        .filter((v) => ["serious", "critical"].includes(v.impact || ""))
        .map((v) => v.id),
    ).toEqual([]);
  });
