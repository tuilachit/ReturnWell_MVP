import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { doctorBrowser } from "../helpers/browser-context.mjs";

async function invitation(fixture: Awaited<ReturnType<typeof doctorBrowser>>) {
  const { local, doctor, owner, organisationId: org } = fixture;
  local.sql(
    `insert into private.inviter_identities(user_id,organisation_id,display_name,practice_name,verified_by) values ('${doctor.userId}','${org}','Dr Fictional','Fictional Recovery Practice','${owner.userId}')`,
  );
  const created = await local.call(
    "manage-invitations",
    {
      operation: "create",
      organisationId: org,
      kind: "practitioner",
      recipientName: "Fictional Recovery",
      recipientEmail: `recovery-${randomUUID()}@example.test`,
      consentConfirmed: true,
      requestId: randomUUID(),
    },
    doctor.client,
  );
  expect(created.status).toBe(200);
  const token = await local.invitationToken(created.body.id);
  const begin = await local.call("invitation-entry", {
    operation: "beginSignup",
    token,
    termsVersion: local.env.TERMS_VERSION,
    privacyVersion: local.env.PRIVACY_VERSION,
    consentAccepted: true,
    requestId: randomUUID(),
  });
  expect(begin.status).toBe(200);
  return {
    id: created.body.id,
    verification: await local.verificationMessage(created.body.id),
  };
}
test("verified mailbox recovers a lost claim response after reload without another OTP exchange", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated local stack");
  const fixture = await doctorBrowser(page, {
    seedSession: false,
    dropClaimResponseOnce: true,
  });
  const invite = await invitation(fixture);
  let verifies = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/auth/v1/verify") verifies++;
  });
  await page.goto("/auth/confirm#" + invite.verification.values);
  await page.getByLabel("Your display name").fill("Fictional Recovery");
  expect(verifies).toBe(0);
  expect(await page.evaluate(() => location.hash)).toBe("");
  await page
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("could not be confirmed");
  await expect(page.getByLabel("Your display name")).toBeDisabled();
  expect(verifies).toBe(1);
  await page.reload();
  await expect(
    page.getByText("Your mailbox is confirmed.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Your display name").fill("Fictional Recovery");
  await page
    .getByRole("button", { name: "Complete signup", exact: true })
    .click();
  await expect(page).toHaveURL(/\/onboarding$/);
  expect(verifies).toBe(1);
  const { local } = fixture;
  expect(
    local.sql(
      `select count(*) from private.invitation_events where invitation_id='${invite.id}' and kind='claimed'`,
    ),
  ).toBe("1");
  expect(
    local.sql(
      `select count(*) from public.practitioner_applications where invitation_id='${invite.id}'`,
    ),
  ).toBe("1");
  expect(
    local.sql(
      `select account_was_new from public.workspace_invitations where id='${invite.id}'`,
    ),
  ).toBe("t");
});
test("forwarded verification cannot claim as another signed-in account", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated local stack");
  const fixture = await doctorBrowser(page);
  const invite = await invitation(fixture);
  let verifies = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/auth/v1/verify") verifies++;
  });
  await page.goto("/auth/confirm#" + invite.verification.values);
  await expect(
    page.getByRole("heading", {
      name: "No recoverable invitation for this account",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Complete signup", exact: true }),
  ).toHaveCount(0);
  expect(verifies).toBe(0);
  expect(
    fixture.local.sql(
      `select status from public.workspace_invitations where id='${invite.id}'`,
    ),
  ).toBe("pending");
});
test("same-account focus retains edits but revoked practice access clears clinical controls", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated local stack");
  const { local, doctor, organisationId: org } = await doctorBrowser(page);
  await page.goto("/");
  await page.getByRole("button", { name: "New referral", exact: true }).click();
  const field = page.getByPlaceholder(
    "Describe the need, goals and relevant context…",
  );
  await field.fill("Fictional unsaved recovery context");
  const response = page.waitForResponse((r) =>
    r.url().endsWith("/workspace-access"),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await response;
  await expect(field).toHaveValue("Fictional unsaved recovery context");
  local.sql(
    `update public.organisation_memberships set active=false where user_id='${doctor.userId}' and organisation_id='${org}'`,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", {
      name: /^(Workspace unavailable|No workspace is available here)$/,
    }),
  ).toBeVisible();
  await expect(field).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(
    "Fictional unsaved recovery context",
  );
});
test("returning-user login preserves a referral destination without account enumeration", async ({
  page,
}) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated local stack");
  await doctorBrowser(page, { seedSession: false });
  const detail = "/referrals/" + randomUUID();
  let redirect = "",
    createUser: unknown;
  await page.route("**/auth/v1/otp**", async (route) => {
    redirect =
      new URL(route.request().url()).searchParams.get("redirect_to") || "";
    createUser = route.request().postDataJSON().create_user;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "http://127.0.0.1:3101" },
      body: "{}",
    });
  });
  await page.goto(detail);
  await page.getByLabel("Work email").fill("fictional-login@example.test");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText(
    "If this email has an invited account",
  );
  expect(redirect).toBe("http://127.0.0.1:3101" + detail);
  expect(createUser).toBe(false);
  await expect(
    page.getByRole("button", { name: /Try again in/ }),
  ).toBeDisabled();
});
