import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { doctorBrowser } from "../helpers/browser-context.mjs";

// Fictional referrals across statuses and weeks so every dashboard card has
// real rows to read. Isolated local stack only.
const plan: [status: string, weeksAgo: number, respondedAfterDays?: number][] = [
  ["sent", 0], ["sent", 1], ["sent", 2],
  ["accepted", 0, 1], ["accepted", 1, 2], ["accepted", 3, 1], ["accepted", 5, 3],
  ["declined", 1, 1], ["declined", 4, 2],
  ["closed", 6, 2], ["cancelled", 2],
];

function seed(f: Awaited<ReturnType<typeof doctorBrowser>>) {
  const statements = plan.map(([status, weeks, later], index) => {
    const id = randomUUID();
    const created = `now() - interval '${weeks * 7 + (index % 3) + 3} days'`;
    const responded = `now() - interval '${weeks * 7 + (index % 3) + 3 - (later ?? 0)} days'`;
    const events: string[] = [];
    if (later && ["accepted", "closed"].includes(status)) events.push(`('${id}','${f.owner.userId}','accepted','{}',${responded})`);
    if (later && status === "declined") events.push(`('${id}','${f.owner.userId}','declined','{"reasonCode":"capacity"}',${responded})`);
    if (status === "closed") events.push(`('${id}','${f.doctor.userId}','closed','{"reasonCode":"handover_completed"}',${responded})`);
    if (status === "cancelled") events.push(`('${id}','${f.doctor.userId}','cancelled','{"reasonCode":"no_longer_required"}',${created})`);
    return `insert into public.referrals(id,reference,organisation_id,created_by,patient_reference,patient_postcode,profession,clinical_summary,funding_path,appointment_format,selection_mode,selected_practitioner_id,consent_confirmed_at,status,created_at,updated_at)
      values('${id}','RW-DESIGN-${index + 1}','${f.organisationId}','${f.doctor.userId}','FICTIONAL-DESIGN-${String(index + 1).padStart(2, "0")}','2000','physiotherapist','Fictional design preview only. No real patient.','Medicare','either','doctor','${f.practitionerId}',now(),'${status}',${created},${later ? responded : created});
      update public.referral_events set created_at=${created} where referral_id='${id}' and event_type='created';
      ${events.length ? `insert into public.referral_events(referral_id,actor_user_id,event_type,details,created_at) values ${events.join(",")};` : ""}`;
  });
  // The creation trigger records the 'created' event as the signed-in doctor.
  f.local.sql(`begin; select set_config('request.jwt.claim.sub','${f.doctor.userId}',true);\n${statements.join("\n")}\ncommit;`);
}

for (const scheme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`dashboard reads real referral data in ${scheme} mode at ${width}px`, async ({ page }) => {
      test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated local Auth.");
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 1100 });
      const f = await doctorBrowser(page);
      seed(f);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Referrals", level: 1 })).toBeVisible();
      const status = page.getByRole("region", { name: "Referral status" });
      await expect(status.getByRole("button", { name: "Accepted: 4. Show these referrals" })).toBeVisible();
      await expect(status.getByRole("button", { name: "Awaiting response: 3. Show these referrals" })).toBeVisible();
      await expect(status.getByRole("button", { name: "Declined: 2. Show these referrals" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Needs attention" }).getByRole("button", { name: /FICTIONAL-DESIGN-/ })).toHaveCount(2);
      await expect(page.getByRole("region", { name: "Latest responses" }).getByRole("button", { name: /FICTIONAL-DESIGN-/ }).first()).toBeVisible();
      await expect(page.getByRole("region", { name: "Sent vs accepted" }).getByRole("listitem").filter({ hasText: /^Accepted/ })).toContainText("5");
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(scheme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const findings = await new AxeBuilder({ page }).include(".dashboard-grid").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(findings.violations.filter((v) => ["serious", "critical"].includes(v.impact || "")).map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
      await page.screenshot({ path: `outputs/dashboard-${scheme}-${width}.png`, fullPage: true });
      expect(errors).toEqual([]);
    });
  }
}

test("the colour mode toggle overrides the device setting and persists", async ({ page }) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated local Auth.");
  await page.emulateMedia({ colorScheme: "dark" });
  await doctorBrowser(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("button", { name: "Switch to dark mode" })).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe("rgb(12, 12, 12)");
});

for (const scheme of ["light", "dark"] as const) {
  test(`workspace screens stay contained and accessible in ${scheme} mode`, async ({ page }) => {
    test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated local Auth.");
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 1000 });
    const f = await doctorBrowser(page);
    seed(f);
    await page.goto("/");
    const check = async (name: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const findings = await new AxeBuilder({ page }).include("#workspace-content").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(findings.violations.filter((v) => ["serious", "critical"].includes(v.impact || "")).map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
      await page.screenshot({ path: `outputs/screen-${name}-${scheme}.png`, fullPage: true });
    };
    await page.getByRole("button", { name: "New referral", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "New referral" })).toBeVisible();
    await check("new-referral");
    await page.getByRole("button", { name: "Referrals", exact: true }).click();
    await page.getByRole("button", { name: /FICTIONAL-DESIGN-04/ }).first().click();
    await expect(page.getByText("RW-DESIGN-4").first()).toBeVisible();
    await check("referral-detail");
    await page.getByRole("button", { name: "Practitioners", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await check("practitioners");
  });
}
