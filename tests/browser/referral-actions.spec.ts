import { test, expect } from "@playwright/test";
import { doctorBrowser } from "../helpers/browser-context.mjs";
import { createReferral } from "../../app/lib/referrals";
import { randomUUID } from "node:crypto";
test("a doctor retries a lost cancellation response and starts a private replacement without reusing consent", async ({
  page,
}) => {
  test.skip(
    !process.env.RW_LOCAL_STACK_DIR,
    "Requires isolated local Supabase.",
  );
  const { doctor, local, organisationId, practitionerId } = await doctorBrowser(
    page,
    { dropTransitionResponseOnce: true },
  );
  const ref = await createReferral(
    doctor.client,
    {
      organisationId,
      organisationName: "Fictional Practice",
      displayName: "Fictional Doctor",
    },
    doctor.userId,
    {
      patientReference: "FICTIONAL-ACTIONS",
      patientPostcode: "2000",
      profession: "physiotherapist",
      clinicalSummary: "Fictional summary to retain in replacement.",
      fundingPath: "Medicare",
      appointmentFormat: "telehealth",
      languageOrAccess: "",
      selectionMode: "doctor",
      selectedPractitionerId: practitionerId,
      consentConfirmed: true,
    },
  );
  await page.goto("/referrals/" + ref.id);
  await page
    .getByRole("button", { name: "Cancel referral", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Reason" })
    .selectOption("entered_in_error");
  await page
    .getByRole("button", { name: "Review cancellation", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Cancel this referral?" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Cancel referral", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check and retry change", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Start replacement referral",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start replacement referral", exact: true })
    .click();
  await expect(page.getByPlaceholder("e.g. Practice record ID")).toHaveValue(
    "FICTIONAL-ACTIONS",
  );
  await expect(
    page.getByPlaceholder("Describe the need, goals and relevant context…"),
  ).toHaveValue("Fictional summary to retain in replacement.");
  expect(
    local.sql(`select status from public.referrals where id='${ref.id}'`),
  ).toBe("cancelled");
  expect(
    local.sql(
      `select count(*) from public.referral_events where referral_id='${ref.id}' and event_type='cancelled'`,
    ),
  ).toBe("1");
  expect(
    local.sql(
      `select count(*) from public.referral_drafts where supersedes_referral_id='${ref.id}' and input->'selectedPractitionerId'='null'::jsonb and not input ? 'consentConfirmed'`,
    ),
  ).toBe("1");
});
test("closing accepted coordination requires an explicit external handover confirmation", async ({
  page,
}) => {
  test.skip(
    !process.env.RW_LOCAL_STACK_DIR,
    "Requires isolated local Supabase.",
  );
  const { doctor, owner, local, organisationId, practitionerId } =
    await doctorBrowser(page);
  const ref = await createReferral(
    doctor.client,
    {
      organisationId,
      organisationName: "Fictional Practice",
      displayName: "Fictional Doctor",
    },
    doctor.userId,
    {
      patientReference: "FICTIONAL-CLOSE",
      patientPostcode: "2000",
      profession: "physiotherapist",
      clinicalSummary: "Fictional external handover.",
      fundingPath: "Medicare",
      appointmentFormat: "telehealth",
      languageOrAccess: "",
      selectionMode: "doctor",
      selectedPractitionerId: practitionerId,
      consentConfirmed: true,
    },
  );
  expect(
    (
      await local.call(
        "respond-to-referral",
        {
          referralId: ref.id,
          expectedVersion: 0,
          requestId: randomUUID(),
          decision: "accepted",
        },
        owner.client,
      )
    ).status,
  ).toBe(200);
  await page.goto("/referrals/" + ref.id);
  await page
    .getByRole("button", { name: "Close referral", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Reason" })
    .selectOption("handover_completed");
  await page
    .getByRole("button", { name: "Review closure", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("checkbox", {
      name: "I confirm the external handover has been completed.",
    })
    .check();
  await page
    .getByRole("button", { name: "Review closure", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close referral", exact: true })
    .click();
  await expect(
    page.getByText(
      "Coordination is closed. The recorded outcome remains in activity.",
    ),
  ).toBeVisible();
  expect(
    local.sql(
      `select details->>'handoverConfirmed' from public.referral_events where referral_id='${ref.id}' and event_type='closed'`,
    ),
  ).toBe("true");
});
test("a cancellation confirmation cannot silently adopt a newer accepted version", async ({
  page,
}) => {
  test.skip(
    !process.env.RW_LOCAL_STACK_DIR,
    "Requires isolated local Supabase.",
  );
  const { doctor, owner, local, organisationId, practitionerId } =
    await doctorBrowser(page);
  const ref = await createReferral(
    doctor.client,
    {
      organisationId,
      organisationName: "Fictional Practice",
      displayName: "Fictional Doctor",
    },
    doctor.userId,
    {
      patientReference: "FICTIONAL-CONFLICT",
      patientPostcode: "2000",
      profession: "physiotherapist",
      clinicalSummary: "Fictional concurrent action.",
      fundingPath: "Medicare",
      appointmentFormat: "telehealth",
      languageOrAccess: "",
      selectionMode: "doctor",
      selectedPractitionerId: practitionerId,
      consentConfirmed: true,
    },
  );
  await page.goto("/referrals/" + ref.id);
  await page
    .getByRole("button", { name: "Cancel referral", exact: true })
    .click();
  await page.getByRole("combobox", { name: "Reason" }).selectOption("other");
  const accepted = await local.call(
    "respond-to-referral",
    {
      referralId: ref.id,
      expectedVersion: 0,
      requestId: randomUUID(),
      decision: "accepted",
    },
    owner.client,
  );
  expect(accepted.status).toBe(200);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText("Accepted — arrange handover", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review cancellation", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel referral", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("record changed");
  expect(
    local.sql(`select status from public.referrals where id='${ref.id}'`),
  ).toBe("accepted");
});
