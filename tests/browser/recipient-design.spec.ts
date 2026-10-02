import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// External invitation service is replaced at the network boundary. No email is sent.
const invitation = {
  invitationId: "10000000-0000-4000-8000-000000000001",
  inviterName: "Taylor Example (fictional)",
  practiceName: "North Sydney Medical Practice (fictional)",
  recipientName: "Alex Example",
  maskedEmail: "a***@example.test",
  kind: "practitioner",
  expiresAt: "2027-10-09T00:00:00Z",
  termsVersion: "private-test-terms-v1",
  privacyVersion: "private-test-privacy-v1",
  websiteUrl: "https://returnwell.example.test",
  termsUrl: "https://returnwell.example.test/terms",
  privacyUrl: "https://returnwell.example.test/privacy",
  supportEmail: "support@example.test",
  businessName: "ReturnWell (fictional test)",
};

async function inviteService(
  page,
  {
    failOnce = false,
    kind = "practitioner",
    practiceName = invitation.practiceName,
  } = {},
) {
  const actions: Record<string, unknown>[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      return route.abort();
    if (!url.pathname.endsWith("/invitation-entry")) return route.continue();
    const headers = {
      "access-control-allow-origin": "http://127.0.0.1:3101",
      "access-control-allow-headers": "content-type,apikey",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    const command = route.request().postDataJSON();
    if (command.operation !== "inspect") {
      actions.push(command);
      if (failOnce) {
        failOnce = false;
        return route.abort("failed");
      }
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers,
      body: JSON.stringify(
        command.operation === "inspect"
          ? { ...invitation, kind, practiceName }
          : { ok: true },
      ),
    });
  });
  return actions;
}

for (const width of [320, 375, 768, 1024, 1440]) {
  test(`invitation is readable, accessible and consent-gated at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    const actions = await inviteService(page);
    await page.goto("/join#invite=fictional-design-test");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      invitation.practiceName,
    );
    await expect(
      page.getByRole("link", { name: "Back to workspace" }),
    ).toHaveCount(0);
    await expect(
      page.getByText(invitation.inviterName, { exact: true }),
    ).toBeVisible();
    expect(
      await page
        .locator(".workflow-lead")
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(16);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const consent = page.getByRole("checkbox", { name: /I accept/ });
    const verify = page.getByRole("button", {
      name: "Verify my email",
      exact: true,
    });
    await expect(consent).not.toBeChecked();
    await expect(verify).toBeDisabled();
    await expect(
      page.getByRole("link", { name: "terms", exact: true }),
    ).toHaveAttribute("href", invitation.termsUrl);
    const findings = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      findings.violations
        .filter((v) => ["serious", "critical"].includes(v.impact || ""))
        .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
    await page.screenshot({
      path: `outputs/recipient-invitation-${width}.png`,
      fullPage: true,
    });
    await consent.check();
    await verify.click();
    await expect(
      page.getByRole("heading", { name: "Check your email", exact: true }),
    ).toBeVisible();
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      operation: "beginSignup",
      consentAccepted: true,
      termsVersion: "private-test-terms-v1",
      privacyVersion: "private-test-privacy-v1",
    });
    await expect(verify).toHaveCount(0);
  });
}

test("declining does not require accepting terms or creating an account", async ({
  page,
}) => {
  const actions = await inviteService(page);
  await page.goto("/join#invite=fictional-design-test");
  await page
    .getByRole("button", { name: "Decline invitation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Invitation declined", exact: true }),
  ).toBeVisible();
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({
    operation: "decline",
    consentAccepted: false,
  });
});

test("lost verification response locks consent and retries the identical command", async ({
  page,
}) => {
  const actions = await inviteService(page, { failOnce: true });
  await page.goto("/join#invite=fictional-design-test");
  await page.getByRole("checkbox", { name: /I accept/ }).check();
  await page
    .getByRole("button", { name: "Verify my email", exact: true })
    .click();
  await expect(page.getByRole("checkbox", { name: /I accept/ })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Decline invitation", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Check and retry the same request" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Check your email", exact: true }),
  ).toBeVisible();
  expect(actions).toHaveLength(2);
  expect(actions[1]).toEqual(actions[0]);
});

test("long practice identity wraps and doctor invitations keep their distinct joining explanation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await inviteService(page, {
    kind: "doctor",
    practiceName: "Fictional " + "Longname".repeat(30),
  });
  await page.goto("/join#invite=fictional-design-test");
  await expect(page.getByText(/join their practice workspace/)).toBeVisible();
  await expect(
    page.getByText(/Approval is required before you can receive referrals/),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("verification and unavailable-invitation recovery remain readable without a workspace detour", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await inviteService(page);
  for (const path of ["/join", "/auth/confirm"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to workspace" }),
    ).toHaveCount(0);
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
  }
  await expect(
    page.getByRole("heading", { name: "Reopen your verification email" }),
  ).toBeVisible();
});

for (const width of [375, 1440]) {
  test(`email verification needs a deliberate action and remains accessible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await inviteService(page);
    let verifications = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/auth/v1/verify")
        verifications++;
    });
    await page.goto(
      "/auth/confirm#token_hash=fictional-design-only&type=invite&invitationId=10000000-0000-4000-8000-000000000001&attemptId=20000000-0000-4000-8000-000000000002",
    );
    await expect(page.getByLabel("Your display name")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Verify and continue" }),
    ).toBeVisible();
    expect(verifications).toBe(0);
    await expect(page).toHaveURL(/\/auth\/confirm$/);
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
    await page.screenshot({
      path: `outputs/recipient-verification-${width}.png`,
      fullPage: true,
    });
  });
}
