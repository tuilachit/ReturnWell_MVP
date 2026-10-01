import { test, expect } from "@playwright/test";
test("served private pages have hardened headers and working hydration", async ({
  page,
}) => {
  for (const path of ["/", "/join", "/auth/confirm", "/security"]) {
    const response = await page.goto(path);
    const headers = response!.headers();
    expect(headers["cache-control"]).toContain("no-store");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    await expect(page.getByRole("heading").first()).toBeVisible();
  }
});
