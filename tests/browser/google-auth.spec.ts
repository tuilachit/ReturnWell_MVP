import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { doctorBrowser } from "../helpers/browser-context.mjs";

// Only the external OAuth boundary is intercepted. The application and SDK run normally.
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort();
  });
});

test("Google starts a PKCE request with minimal scopes and keeps the referral destination", async ({ page }) => {
  let authorize: URL | undefined;
  await page.route("**/auth/v1/authorize**", async route => {
    authorize = new URL(route.request().url());
    await route.fulfill({ contentType: "text/html", body: "<p>Fictional external OAuth boundary</p>" });
  });
  const destination = "/referrals/10000000-0000-4000-8000-000000000001";
  await page.goto(destination);
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect.poll(() => authorize?.searchParams.get("provider")).toBe("google");
  expect(authorize!.searchParams.get("code_challenge_method")).toBe("s256");
  expect(authorize!.searchParams.get("code_challenge")).toMatch(/^[a-zA-Z0-9_-]{43}$/);
  expect(authorize!.searchParams.get("scopes")).toBe("openid email profile");
  const callback = new URL(authorize!.searchParams.get("redirect_to")!);
  expect(callback.origin).toBe("http://127.0.0.1:3101");
  expect(callback.pathname).toBe("/auth/google");
  expect(callback.searchParams.get("next")).toBe(destination);
  expect(callback.searchParams.has("start")).toBe(false);
});

test("cancelled Google sign-in clears provider details and offers email fallback", async ({ page }) => {
  await page.goto("/auth/google?error=access_denied&error_description=PRIVATE_PROVIDER_DETAIL&next=%2Fsecurity");
  await expect(page.getByRole("alert")).toContainText("cancelled");
  await expect(page).toHaveURL("http://127.0.0.1:3101/auth/google");
  await expect(page.locator("body")).not.toContainText("PRIVATE_PROVIDER_DETAIL");
  await page.getByRole("link", { name: "Use email instead" }).click();
  await expect(page).toHaveURL(/\/security$/);
  await expect(page.getByLabel("Work email", { exact: true })).toBeVisible();
});

test("missing PKCE proof cannot exchange a code or open a workspace", async ({ page }) => {
  let exchanges = 0;
  page.on("request", request => {
    if (request.url().includes("grant_type=pkce")) exchanges++;
  });
  await page.goto("/auth/google?code=fictional-stolen-code&next=https%3A%2F%2Fattacker.test");
  await expect(page.getByRole("alert")).toContainText("could not be completed");
  await expect(page).toHaveURL("http://127.0.0.1:3101/auth/google");
  expect(exchanges).toBe(0);
  expect(await page.getByRole("link", { name: "Use email instead" }).getAttribute("href")).toBe("/");
  await expect(page.getByRole("button", { name: "New referral", exact: true })).toHaveCount(0);
});

for (const member of [true, false]) {
  test(`OAuth callback checks real workspace permissions (${member ? "member" : "no membership"}; provider boundary simulated)`, async ({ page }) => {
    test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated local Auth and database");
    const fixture = await doctorBrowser(page, { seedSession: false });
    const actor = member ? fixture.doctor : await fixture.local.verifiedFixtureUser(`oauth-uninvited-${randomUUID()}@example.test`);
    const { data: { session } } = await actor.client.auth.getSession();
    let callback: URL | undefined;
    let exchanges = 0;
    await page.route("**/auth/v1/authorize**", async route => {
      callback = new URL(new URL(route.request().url()).searchParams.get("redirect_to")!);
      await route.fulfill({ contentType: "text/html", body: "<p>Fictional external OAuth boundary</p>" });
    });
    await page.route("**/auth/v1/token?grant_type=pkce", async route => {
      exchanges++;
      expect(route.request().postDataJSON().code_verifier).toBeTruthy();
      expect(route.request().postDataJSON().auth_code).toBe("fictional-provider-code");
      // Real local Auth-issued session; only Google's external exchange is simulated.
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(session) });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
    await expect.poll(() => callback?.pathname).toBe("/auth/google");
    callback!.searchParams.set("code", "fictional-provider-code");
    await page.goto(callback!.toString());
    await expect(page).toHaveURL("http://127.0.0.1:3101/");
    if (member) {
      await expect(page.getByRole("button", { name: "New referral", exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole("heading", { name: "No workspace is available here" })).toBeVisible();
      await expect(page.getByText("You are signed in, but this account has no authorised workspace", { exact: false })).toBeVisible();
      await expect(page.getByRole("button", { name: "New referral", exact: true })).toHaveCount(0);
    }
    expect(exchanges).toBe(1);
    await page.reload();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByLabel("Work email", { exact: true })).toBeVisible();
  });
}

test("a rejected OAuth callback does not reuse an older authenticated session", async ({ page }) => {
  test.skip(!process.env.RW_LOCAL_STACK_DIR, "Requires isolated local Auth and database");
  await doctorBrowser(page);
  let callback: URL | undefined;
  let exchanges = 0;
  await page.route("**/auth/v1/authorize**", async route => {
    callback = new URL(new URL(route.request().url()).searchParams.get("redirect_to")!);
    await route.fulfill({ contentType: "text/html", body: "<p>Fictional external OAuth boundary</p>" });
  });
  await page.route("**/auth/v1/token?grant_type=pkce", async route => {
    exchanges++;
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "invalid_grant", error_description: "PRIVATE_REJECTED_CODE" }) });
  });
  await page.goto("/auth/google?start=1");
  await expect.poll(() => callback?.pathname).toBe("/auth/google");
  callback!.searchParams.set("code", "fictional-expired-code");
  await page.goto(callback!.toString());
  await expect(page.getByRole("alert")).toContainText("could not be completed");
  await expect(page).toHaveURL("http://127.0.0.1:3101/auth/google");
  await expect(page.locator("body")).not.toContainText("PRIVATE_REJECTED_CODE");
  await expect(page.getByRole("button", { name: "New referral", exact: true })).toHaveCount(0);
  expect(exchanges).toBe(1);
});
