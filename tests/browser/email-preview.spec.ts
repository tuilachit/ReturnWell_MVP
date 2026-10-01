import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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
