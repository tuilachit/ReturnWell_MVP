import { test, expect } from "@playwright/test";
import { doctorBrowser } from "../helpers/browser-context.mjs";
import { randomUUID } from "node:crypto";
test("reconfirmation keeps its original request after a lost response and a newer progress version", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated local stack");
  const {
    local,
    doctor,
    owner,
    organisationId: org,
    practitionerId,
  } = await doctorBrowser(page, { dropReconfirmResponseOnce: true });
  local.sql(
    `insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by) values ('${doctor.userId}','${org}','Dr Fictional Reviewed','Fictional Draft Practice','${owner.userId}')`,
  );
  const draft = await local.call(
    "manage-referral",
    {
      operation: "draft.save",
      id: randomUUID(),
      organisationId: org,
      expectedVersion: -1,
      requestId: randomUUID(),
      input: {
        patientReference: "Fictional reconfirm case",
        patientPostcode: "2000",
        profession: "physiotherapist",
        clinicalSummary: "Fictional summary",
        fundingPath: "medicare",
        appointmentFormat: "telehealth",
      },
    },
    doctor.client,
  );
  expect(draft.status).toBe(200);
  const email = local.sql(
    `select email from auth.users where id='${owner.userId}'`,
  );
  const created = await local.call(
    "manage-referral",
    {
      operation: "draft.invite",
      id: draft.body.id,
      expectedVersion: draft.body.version,
      requestId: randomUUID(),
      recipientName: "Fictional Receiver",
      recipientEmail: email,
      contactBasis: "recipient_requested",
      contactConsentConfirmed: true,
      consentConfirmed: true,
    },
    doctor.client,
  );
  expect(created.status).toBe(200);
  const ref = created.body.referralId,
    inv = created.body.invitationId;
  // Test-only setup for the doctor's retry UI. Mailbox proof itself is covered
  // through real Auth in referral-growth-local.test.mjs, not simulated here.
  local.sql(`update public.workspace_invitations set status='claimed',claimed_by='${owner.userId}',signup_completed_at=now() where id='${inv}';
    update private.referral_invitations set consent_confirmed_at=now()-interval '8 days',consent_valid_until=now()-interval '1 day' where referral_id='${ref}';
    update public.practitioners set accepting_new_referrals=false where id='${practitionerId}';
    set role service_role;select public.rw_workflow(null,'growth.sweep','{}');`);
  await page.goto("/referrals/" + ref);
  await page
    .getByRole("button", { name: "Review and reconfirm release", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm consent and recheck", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText(
      "The recipient is not currently eligible for new referrals.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm consent and recheck", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(
    local.sql(
      `select generation from private.referral_invitations where referral_id='${ref}'`,
    ),
  ).toBe("2");
});
// The former separate/manual invitation UI is intentionally gone. Its real
// Auth/HTTP lost-response, single invitation and no premature clinical outbox
// assertions now run against source-backed selection in directory-referral.spec.ts.
