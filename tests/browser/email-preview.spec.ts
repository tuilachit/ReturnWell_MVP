import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { invitationEmail } from "../../supabase/functions/_shared/workflow-security";
import {
  buildNotification,
  verificationEmail,
} from "../../supabase/functions/_shared/email";
const config = {
  appUrl: "https://returnwell.example.test",
  websiteUrl: "https://returnwell.example.test",
  businessName: "Fictional ReturnWell",
  supportEmail: "support@example.test",
  privacyUrl: "https://returnwell.example.test/privacy",
  termsUrl: "https://returnwell.example.test/terms",
  termsVersion: "v1",
  privacyVersion: "v1",
};
for (const width of [320, 375, 768])
  test(`transactional email web previews remain readable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/*", (route) => route.abort());
    const messages = [
      invitationEmail(
        {
          kind: "practitioner",
          recipient_name: "Fictional " + "Longname".repeat(20),
          inviter_name: "Dr Fictional",
          practice_name: "Fictional Practice",
          expires_at: "2026-10-09T00:00:00Z",
        },
        "fictional",
        config,
      ),
      verificationEmail(
        config,
        config.appUrl + "/auth/confirm#token_hash=fictional",
        "2026-10-02T03:00:00Z",
      ),
      buildNotification(
        {
          id: "fictional",
          referralId: "10000000-0000-4000-8000-000000000001",
          kind: "referral_cancelled",
          recipientEmail: "fictional@example.test",
          idempotencyKey: "fictional",
          templateData: {},
        },
        config.appUrl,
        config,
      ),
    ];
    for (const message of messages) {
      await page.setContent(message.html);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
      for (const element of await page.locator("body > *").all()) {
        await expect(element).toHaveAttribute("lang", "en");
        await expect(element).toHaveAttribute("dir", "ltr");
      }
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
      if (message === messages[0])
        await page.screenshot({
          path: `outputs/email-preview-${width}.png`,
          fullPage: true,
        });
    }
  });

for (const colorScheme of ["light", "dark"] as const)
  test(`practice invitation presents one review action before supporting details (${colorScheme} preference)`, async ({ page }) => {
    await page.setViewportSize({ width: 680, height: 1000 });
    await page.emulateMedia({ colorScheme });
    await page.route("**/*", (route) => route.abort());
    const message = invitationEmail({
      kind: "practitioner",
      recipient_name: "Alex Example",
      inviter_name: "Dr Taylor Example (fictional)",
      practice_name: "Example Medical Practice (fictional)",
      expires_at: "2026-10-09T00:00:00Z",
    }, "fictional-preview-not-a-live-invitation", config);
    await page.setContent(message.html);
    const action = page.getByRole("link", { name: "Review invitation", exact: true });
    await expect(action).toHaveCount(1);
    await expect(action).toHaveAttribute("href", "https://returnwell.example.test/join#invite=fictional-preview-not-a-live-invitation");
    const actionBounds = await action.boundingBox();
    const contextBounds = await page.getByText(/Not expecting this\?/).boundingBox();
    expect(actionBounds).not.toBeNull();
    expect(contextBounds).not.toBeNull();
    expect(actionBounds!.height).toBeGreaterThanOrEqual(44);
    expect(actionBounds!.y + actionBounds!.height).toBeLessThan(contextBounds!.y);
    await expect(page.getByText(/Sent by ReturnWell on behalf of Example Medical Practice/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Contact support/ })).toBeVisible();
    const findings = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(findings.violations.filter((v) => ["serious", "critical"].includes(v.impact || "")).map((v) => v.id)).toEqual([]);
    await mkdir("outputs", { recursive: true });
    if (colorScheme === "light") {
      await writeFile("outputs/practice-invitation-preview.html", message.html);
      await writeFile("outputs/practice-invitation-preview.txt", `Subject: ${message.subject}\n\n${message.text}`);
    }
    await page.screenshot({ path: `outputs/practice-invitation-${colorScheme}.png`, fullPage: true });
  });
