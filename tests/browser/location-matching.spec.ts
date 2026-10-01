import { test, expect } from "@playwright/test";
import { doctorBrowser } from "../helpers/browser-context.mjs";
import { geographyImportSql } from "../../scripts/import-geography.mjs";

async function geographyBrowser(page) {
  const fixture = await doctorBrowser(page);
  const { local, practitionerId, organisationId } = fixture;
  const previous = local.sql("select source_version from private.geography_active");
  const versions = [];
  function install(localities) {
    const version = `fictional-recovery-${organisationId}-${versions.length}`;
    versions.push(version);
    local.sql(geographyImportSql({
      source: { version, url: "https://example.org/fictional", license: "Test fixture only", attribution: "Fictional recovery reference", sha256: "c".repeat(64), publishedAt: "2026-10-01" },
      localities,
    }));
  }
  install([{ state: "NSW", postcode: "2000", suburb: "Origin Test", latitude: -33, longitude: 151 }]);
  local.sql(`insert into public.practitioner_locations(practitioner_id,suburb,postcode,state,is_primary) values ('${practitionerId}','Origin Test','2000','NSW',true);`);
  return {
    ...fixture, install,
    cleanup() {
      local.sql(`delete from private.geography_active where source_version in (${versions.map(v => `'${v}'`).join(",")});`);
      if (previous) local.sql(`select private.activate_geography('${previous.replaceAll("'", "''")}');`);
      local.sql(`update public.practitioners set lifecycle_status='inactive' where id='${practitionerId}';`);
      for (const version of versions) local.sql(`delete from private.postcode_localities where source_version='${version}'; delete from private.geography_sources where version='${version}';`);
    },
  };
}

test("rejected finalisation preserves the entire saved geography snapshot", async ({ page }) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated local Supabase.");
  test.setTimeout(120000);
  const fixture = await geographyBrowser(page);
  const { local, doctor, practitionerId, clinic } = fixture;
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "New referral", exact: true }).click();
    await page.getByPlaceholder("e.g. Practice record ID").fill("GEO-REJECT-FICTIONAL");
    await page.getByPlaceholder("e.g. 2000").fill("2000");
    await page.getByPlaceholder("Describe the need, goals and relevant context…").fill("Fictional rejected finalisation test.");
    await expect(page.getByLabel("Patient suburb (NSW)")).toBeEnabled();
    await page.getByLabel("Patient suburb (NSW)").selectOption("NSW:2000:origin test");
    await page.getByLabel("Approximate radius").selectOption("5");
    await page.getByRole("button", { name: "Find practitioners" }).click();
    await page.getByRole("radio", { name: new RegExp(clinic) }).check();
    await page.getByRole("button", { name: "Review referral" }).click();
    await page.getByRole("checkbox", { name: "I confirm the patient has consented and the information is accurate." }).check();
    local.sql(`update public.practitioners set accepting_new_referrals=false where id='${practitionerId}';`);
    await page.getByRole("button", { name: "Record referral", exact: true }).click();
    await expect(page.getByText("This practitioner no longer meets the referral requirements. Review your selection.")).toBeVisible();
    const saved = JSON.parse(local.sql(`select input from public.referral_drafts where created_by='${doctor.userId}';`));
    expect(saved.patientLocalityId).toBe("NSW:2000:origin test");
    expect(saved.searchRadiusKm).toBe(5);
    expect(local.sql(`select count(*) from public.referrals where created_by='${doctor.userId}'`)).toBe("0");
    await page.reload();
    await page.getByRole("button", { name: "New referral", exact: true }).click();
    await page.getByLabel("Resume a saved draft").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Load draft", exact: true }).click();
    await expect(page.getByLabel("Patient suburb (NSW)")).toHaveValue("NSW:2000:origin test");
    await expect(page.getByLabel("Approximate radius")).toHaveValue("5");
    local.sql(`update public.practitioners set accepting_new_referrals=true where id='${practitionerId}';`);
    await page.getByRole("button", { name: "Find practitioners" }).click();
    await page.getByRole("radio", { name: new RegExp(clinic) }).check();
    await page.getByRole("button", { name: "Review referral" }).click();
    await page.getByRole("checkbox", { name: "I confirm the patient has consented and the information is accurate." }).check();
    await page.getByRole("button", { name: "Record referral", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Referral recorded", level: 1 })).toBeVisible();
    expect(local.sql(`select count(*) from public.referrals where created_by='${doctor.userId}'`)).toBe("1");
    const completed = JSON.parse(local.sql(`select input from public.referral_drafts where created_by='${doctor.userId}' and finalized_referral_id is not null;`));
    expect(completed.patientLocalityId).toBe("NSW:2000:origin test");
    expect(completed.searchRadiusKm).toBe(5);
  } finally { fixture.cleanup(); }
});

test("doctor shortlist refresh clears a stale location and practitioner selection", async ({ page }) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated local Supabase.");
  test.setTimeout(120000);
  const fixture = await geographyBrowser(page);
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "New referral", exact: true }).click();
    await page.getByPlaceholder("e.g. Practice record ID").fill("GEO-RECOVERY-FICTIONAL");
    await page.getByPlaceholder("e.g. 2000").fill("2000");
    await page.getByPlaceholder("Describe the need, goals and relevant context…").fill("Fictional shortlist reference recovery.");
    await expect(page.getByLabel("Patient suburb (NSW)")).toBeEnabled();
    await page.getByLabel("Patient suburb (NSW)").selectOption("NSW:2000:origin test");
    await page.getByLabel("Approximate radius").selectOption("5");
    await page.getByRole("button", { name: "Find practitioners" }).click();
    await page.getByRole("radio", { name: new RegExp(fixture.clinic) }).check();
    fixture.install([{ state: "NSW", postcode: "2000", suburb: "Origin Test", latitude: null, longitude: null }]);
    await page.getByRole("button", { name: "Refresh workspace", exact: true }).click();
    await expect(page.getByText("This suburb has no usable reference coordinates. Refresh the location options or browse without distance.")).toBeVisible();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByLabel("Patient suburb (NSW)")).toHaveValue("");
    await expect(page.getByLabel("Approximate radius")).toBeDisabled();
    await expect(page.getByRole("radio").first()).toBeVisible();
    await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Review referral" })).toBeDisabled();
    await expect(page.getByRole("alert")).not.toBeVisible();
    await expect(page.getByLabel("Patient suburb (NSW)").locator("option").last()).toContainText("distance unavailable");
  } finally { fixture.cleanup(); }
});

for (const change of ["removed suburb", "removed coordinates"]) {
  test(`directory recovers from a reference edition with ${change}`, async ({ page }) => {
    test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated local Supabase.");
    test.setTimeout(120000);
    const fixture = await geographyBrowser(page);
    try {
      await page.goto("/");
      await page.getByRole("button", { name: "Practitioners", exact: true }).click();
      await page.getByRole("textbox", { name: "Search practitioners" }).fill(fixture.clinic);
      await page.getByLabel("Near postcode", { exact: true }).fill("2000");
      await expect(page.getByLabel("Patient suburb (NSW)")).toBeEnabled();
      await page.getByLabel("Patient suburb (NSW)").selectOption("NSW:2000:origin test");
      await page.getByLabel("Approximate radius").selectOption("5");
      await expect(page.getByRole("button", { name: "Nearby options (1)", exact: true })).toBeVisible();
      fixture.install([{ state: "NSW", postcode: "2000", suburb: change === "removed suburb" ? "Replacement Test" : "Origin Test", latitude: null, longitude: null }]);
      await page.getByRole("textbox", { name: "Search practitioners" }).fill(`${fixture.clinic} `);
      await expect(page.getByRole("alert")).toBeVisible();
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await expect(page.getByRole("alert")).not.toBeVisible();
      await expect(page.getByLabel("Patient suburb (NSW)")).toHaveValue("");
      await expect(page.getByLabel("Approximate radius")).toHaveValue("");
      await expect(page.getByLabel("Approximate radius")).toBeDisabled();
      await expect(page.getByRole("button", { name: "In-person options (1)", exact: true })).toBeVisible();
      await expect(page.getByLabel("Patient suburb (NSW)").locator("option").last()).toContainText(change === "removed suburb" ? "Replacement Test" : "Origin Test");
    } finally { fixture.cleanup(); }
  });
}

test("doctor confirms postcode suburb, searches nearest secondary location and reloads a private draft", async ({ page }) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated local Supabase.");
  test.setTimeout(120000);
  page.setDefaultTimeout(10000);
  const { local, doctor, practitionerId, clinic, organisationId } = await doctorBrowser(page);
  const previous = local.sql("select source_version from private.geography_active");
  const version = `fictional-browser-${organisationId}`;
  local.sql(geographyImportSql({
    source: { version, url: "https://example.org/fictional", license: "Test fixture only", attribution: "Fictional suburb reference", sha256: "b".repeat(64), publishedAt: "2026-10-01" },
    localities: [
      { state: "NSW", postcode: "2000", suburb: "Origin Test", latitude: -33, longitude: 151 },
      { state: "NSW", postcode: "2000", suburb: "Other Test", latitude: -34, longitude: 151 },
    ],
  }));
  local.sql(`insert into public.practitioner_locations(practitioner_id,suburb,postcode,state,is_primary) values ('${practitionerId}','Unmapped Test','2999','NSW',true),('${practitionerId}','Origin Test','2000','NSW',false);`);
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Practitioners", exact: true }).click();
    await page.getByRole("textbox", { name: "Search practitioners" }).fill(clinic);
    await page.getByLabel("Near postcode", { exact: true }).fill("2000");
    await expect(page.getByLabel("Patient suburb (NSW)")).toBeEnabled();
    await expect(page.getByLabel("Patient suburb (NSW)")).toHaveValue("");
    await expect(page.getByLabel("Approximate radius")).toBeDisabled();
    await page.getByLabel("Patient suburb (NSW)").selectOption("NSW:2000:origin test");
    await page.getByLabel("Approximate radius").selectOption("5");
    await expect(page.getByRole("button", { name: "Nearby options (1)", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/Origin Test 2000.*Approx\. 0\.0 km/)).toBeVisible();
    await expect(page.getByText(version, { exact: false })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByLabel("Approximate radius")).toBeEnabled();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByLabel("Near postcode", { exact: true }).fill("9999");
    await expect(page.getByText("No reference location was found for this postcode. You can still browse without distance.")).toBeVisible();
    await expect(page.getByLabel("Approximate radius")).toBeDisabled();
    await expect(page.getByRole("button", { name: "In-person options (1)", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "New referral +", exact: true }).click();
    await page.getByPlaceholder("e.g. Practice record ID").fill("GEO-FICTIONAL");
    await page.getByPlaceholder("e.g. 2000").fill("2000");
    await page.getByPlaceholder("Describe the need, goals and relevant context…").fill("Fictional locality test; no real patient.");
    await expect(page.getByLabel("Patient suburb (NSW)")).toBeEnabled();
    await page.getByLabel("Patient suburb (NSW)").selectOption("NSW:2000:origin test");
    await page.getByLabel("Approximate radius").selectOption("5");
    await page.getByRole("button", { name: "Find practitioners" }).click();
    await expect(page.getByRole("button", { name: "Nearby options (1)", exact: true })).toBeVisible();
    await expect(page.getByText(/Distance ranking is not available yet/)).toHaveCount(0);
    await page.getByRole("radio", { name: new RegExp(clinic) }).check();
    await page.getByLabel("Approximate radius").selectOption("10");
    await expect(page.getByRole("radio", { name: new RegExp(clinic) })).not.toBeChecked();
    await page.getByRole("button", { name: "Back", exact: true }).first().click();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("Draft saved privately. No email was sent.")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "New referral", exact: true }).click();
    await page.getByLabel("Resume a saved draft").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Load draft", exact: true }).click();
    await expect(page.getByLabel("Patient suburb (NSW)")).toHaveValue("NSW:2000:origin test");
    await expect(page.getByLabel("Approximate radius")).toHaveValue("10");
    await page.getByLabel("Appointment format").selectOption("telehealth");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText("Draft saved privately. No email was sent.")).toBeVisible();
    await page.getByRole("button", { name: "Practitioners", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Practitioners", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.getByRole("button", { name: "New referral +", exact: true }).click();
    expect(local.sql(`select count(*) from public.referrals where created_by='${doctor.userId}'`)).toBe("0");
    await page.getByPlaceholder("e.g. 2000").fill("2001");
    await expect(page.getByLabel("Patient suburb (NSW)")).toHaveValue("");
    await expect(page.getByLabel("Approximate radius")).toBeDisabled();
  } finally {
    local.sql(`delete from private.geography_active where source_version='${version}';`);
    if (previous) local.sql(`select private.activate_geography('${previous.replaceAll("'", "''")}');`);
    local.sql(`update public.practitioners set lifecycle_status='inactive' where id='${practitionerId}'; delete from private.postcode_localities where source_version='${version}'; delete from private.geography_sources where version='${version}';`);
  }
});
