import { test, expect } from "@playwright/test";
test("an interrupted module load can recover on deliberate reload without an automatic submission", async ({
  page,
}) => {
  let blocked = 0,
    posts = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      new URL(r.url()).pathname.includes("/functions/")
    )
      posts++;
  });
  await page.route("**/app/doctor-portal.tsx*", (route) => {
    blocked++;
    return route.abort();
  });
  await page.goto("/");
  await expect.poll(() => blocked).toBeGreaterThan(0);
  expect(posts).toBe(0);
  await page.unroute("**/app/doctor-portal.tsx*");
  await page.reload();
  await page
    .getByRole("button", { name: "Preview empty workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Referrals", exact: true }),
  ).toBeVisible();
  expect(posts).toBe(0);
});
