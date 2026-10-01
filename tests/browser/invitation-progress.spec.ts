import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { doctorBrowser } from "../helpers/browser-context.mjs";
test("inviter sees separate account and delivery outcomes, expiry and deliberate link rotation", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated local stack");
  const {
    local,
    doctor,
    owner,
    organisationId: org,
  } = await doctorBrowser(page);
  local.sql(
    `insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by) values ('${doctor.userId}','${org}','Dr Fictional','Fictional Practice','${owner.userId}')`,
  );
  async function create(name: string) {
    const result = await local.call(
      "manage-invitations",
      {
        operation: "create",
        organisationId: org,
        kind: "practitioner",
        recipientName: name,
        recipientEmail: `${randomUUID()}@example.test`,
        consentConfirmed: true,
        requestId: randomUUID(),
      },
      doctor.client,
    );
    expect(result.status).toBe(200);
    return result.body.id;
  }
  const existing = await create("Fictional Existing"),
    expired = await create("Fictional Expired"),
    pending = await create("Fictional Pending");
  local.sql(`update public.workspace_invitations set status='claimed',claimed_by='${owner.userId}',signup_completed_at=now(),account_was_new=false where id='${existing}';
    update private.email_jobs set state='sent',provider_message_id='${randomUUID()}' where family='invitation' and related_id='${existing}';
    insert into private.email_events(provider_event_id,provider_message_id,event_type,occurred_at,matched_job_id) select '${randomUUID()}',provider_message_id,'delivered',now(),id from private.email_jobs where family='invitation' and related_id='${existing}';
    update public.workspace_invitations set expires_at=now()-interval '1 minute' where id='${expired}';
    update public.workspace_invitations set updated_at=now()-interval '2 minutes' where id='${pending}';`);
  await page.goto("/invitations");
  const records = page.locator(".workflow-records");
  const old = records
    .getByRole("listitem")
    .filter({ hasText: "Fictional Existing" });
  await expect(old).toContainText("Existing account confirmed");
  await expect(old).toContainText("Email delivered — this does not mean read");
  await expect(old).not.toContainText("New account");
  const expiredRow = records
    .getByRole("listitem")
    .filter({ hasText: "Fictional Expired" });
  await expect(expiredRow).toContainText("Invitation expired");
  await expect(
    expiredRow.getByRole("button", { name: "Resend with new link" }),
  ).toHaveCount(0);
  const current = records
    .getByRole("listitem")
    .filter({ hasText: "Fictional Pending" });
  await current.getByRole("button", { name: "Resend with new link" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "previous link will stop working",
  );
  expect(
    local.sql(
      `select generation from public.workspace_invitations where id='${pending}'`,
    ),
  ).toBe("1");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Replace link and queue email" })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(current).toContainText("Email queued");
  await expect(
    current.getByRole("button", { name: "Resend with new link" }),
  ).toBeDisabled();
  await current.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "This link will stop working",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Revoke invitation", exact: true })
    .click();
  await expect(current).toContainText("Invitation revoked");
  await expect(records).not.toContainText(/token_hash|envelope|#token=/);
});
