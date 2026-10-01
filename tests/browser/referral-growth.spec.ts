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
test("doctor can invite a recipient from a referral and recover a lost response without duplicating it", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated local stack");
  const {
    local,
    doctor,
    owner,
    organisationId: org,
  } = await doctorBrowser(page, { dropInvitationResponseOnce: true });
  local.sql(
    `insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by) values ('${doctor.userId}','${org}','Dr Fictional Reviewed','Fictional Draft Practice','${owner.userId}')`,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "New referral", exact: true }).click();
  await page
    .getByPlaceholder("e.g. Practice record ID")
    .fill("FICTIONAL-GROWTH");
  await page.getByPlaceholder("e.g. 2000").fill("2000");
  await page
    .getByPlaceholder("Describe the need, goals and relevant context…")
    .fill("Fictional private growth summary");
  await page.getByRole("button", { name: "Find practitioners" }).click();
  await page
    .getByRole("button", { name: "Invite a practitioner", exact: true })
    .click();
  await page
    .getByLabel("Recipient professional name", { exact: true })
    .fill("Fictional Receiver");
  await page
    .getByLabel("Recipient work email", { exact: true })
    .fill("new-fictional-recipient@example.test");
  await page
    .getByLabel("Permission to contact", { exact: true })
    .selectOption("recipient_requested");
  await page
    .getByRole("checkbox", {
      name: "I have permission to send this invitation.",
      exact: true,
    })
    .check();
  await page
    .getByRole("checkbox", {
      name: "I confirm patient consent for this referral and its seven-day release window.",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", {
      name: "Save referral and queue invitation",
      exact: true,
    })
    .click();
  await expect(page.getByRole("alert")).toContainText("not confirmed");
  await page
    .getByRole("button", { name: "Check and retry invitation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Referral onboarding", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Waiting for recipient signup", { exact: true }),
  ).toBeVisible();
  expect(
    local.sql(
      `select count(*) from public.referrals where created_by='${doctor.userId}' and status='awaiting_onboarding' and selected_practitioner_id is null`,
    ),
  ).toBe("1");
  expect(
    local.sql(
      `select count(*) from public.workspace_invitations where invited_by='${doctor.userId}' and recipient_email_normalized='new-fictional-recipient@example.test'`,
    ),
  ).toBe("1");
  expect(
    local.sql(
      `select count(*) from public.notification_outbox o join public.referrals r on r.id=o.referral_id where r.created_by='${doctor.userId}'`,
    ),
  ).toBe("0");
});
