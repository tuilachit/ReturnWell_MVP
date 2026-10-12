import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Invitation and Auth services are replaced at the network boundary. No email
// is sent and no session is created.
const referralId = "20000000-0000-4000-8000-000000000002";
const invitation = {
  invitationId: "10000000-0000-4000-8000-000000000001",
  inviterName: "Dr Taylor Example (fictional)",
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
  intendedIdentity: {
    displayName: "Alex Example",
    practiceName: "Harbour Physio (fictional)",
    professionId: "physiotherapist",
    reviewRequired: true,
    quickAccess: true,
    referralId,
  },
};
const verification = {
  email: "alex@example.test",
  type: "magiclink",
  invitationId: invitation.invitationId,
  attemptId: "30000000-0000-4000-8000-000000000003",
  expiresAt: "2027-10-01T00:15:00Z",
};

async function services(page) {
  const actions: Record<string, unknown>[] = [];
  const verifies: Record<string, unknown>[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) return route.abort();
    const headers = {
      "access-control-allow-origin": "http://127.0.0.1:3101",
      "access-control-allow-headers": "content-type,apikey,authorization,x-client-info,x-supabase-api-version",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (url.pathname.endsWith("/auth/v1/verify")) {
      verifies.push(route.request().postDataJSON());
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        headers,
        body: JSON.stringify({ code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" }),
      });
    }
    if (!url.pathname.endsWith("/invitation-entry")) return route.continue();
    const command = route.request().postDataJSON();
    if (command.operation !== "inspect") actions.push(command);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers,
      body: JSON.stringify(
        command.operation === "inspect"
          ? invitation
          : command.operation === "beginSignup"
            ? { ok: true, verification }
            : { ok: true },
      ),
    });
  });
  return { actions, verifies };
}

for (const width of [320, 375, 768, 1440]) {
  test(`quick referral is specific, accessible and terms-gated at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { actions } = await services(page);
    await page.goto("/join#invite=fictional-quick-test");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      `Referral from ${invitation.practiceName}`,
    );
    await expect(page.locator(".workflow-lead")).toContainText(
      `${invitation.inviterName} at ${invitation.practiceName} has referred a patient to Alex Example at Harbour Physio (fictional)`,
    );
    await expect(page.getByText(/never asks for\s+passwords, bank, card or Medicare/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const send = page.getByRole("button", { name: /I’m Alex Example — email me a code/ });
    await expect(send).toBeDisabled();
    const findings = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(
      findings.violations
        .filter((v) => ["serious", "critical"].includes(v.impact || ""))
        .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
    await page.screenshot({ path: `outputs/quick-referral-${width}.png`, fullPage: true });
    await page.getByRole("checkbox", { name: /I agree/ }).check();
    await send.click();
    const code = page.getByRole("textbox", { name: "6-digit code" });
    await expect(code).toBeVisible();
    await expect(code).toBeFocused();
    await expect(code).toHaveAttribute("inputmode", "numeric");
    await expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(await code.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `outputs/quick-referral-code-${width}.png`, fullPage: true });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      operation: "beginSignup",
      consentAccepted: true,
      termsVersion: "private-test-terms-v1",
      privacyVersion: "private-test-privacy-v1",
    });
    await expect(page.getByRole("button", { name: /Send a new code in \d+s/ })).toBeDisabled();
  });
}

test("a wrong code is refused without claiming the invitation", async ({ page }) => {
  const { actions, verifies } = await services(page);
  await page.goto("/join#invite=fictional-quick-test");
  await page.getByRole("checkbox", { name: /I agree/ }).check();
  await page.getByRole("button", { name: /email me a code/ }).click();
  const code = page.getByRole("textbox", { name: "6-digit code" });
  await code.fill("12a34-56");
  await expect(code).toHaveValue("123456");
  await page.getByRole("button", { name: "Open referral" }).click();
  await expect(page.getByRole("alert")).toContainText("That code didn’t work");
  expect(verifies).toHaveLength(1);
  expect(verifies[0]).toMatchObject({ email: verification.email, token: "123456", type: "magiclink" });
  expect(actions.map((a) => a.operation)).toEqual(["beginSignup"]);
  await expect(page).toHaveURL(/\/join/);
});

test("declining needs no terms, code or account", async ({ page }) => {
  const { actions, verifies } = await services(page);
  await page.goto("/join#invite=fictional-quick-test");
  await page.getByRole("button", { name: "Not me, or decline" }).click();
  await expect(page.getByRole("heading", { name: "Referral declined" })).toBeVisible();
  expect(actions).toEqual([{ operation: "decline", token: "fictional-quick-test" }]);
  expect(verifies).toHaveLength(0);
});
