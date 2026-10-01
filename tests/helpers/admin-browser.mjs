import { randomUUID } from "node:crypto";
import { localRuntime } from "./local-runtime.mjs";
import { workflowHandler } from "../../supabase/functions/_shared/workflow-http.ts";
import { enrollFixtureMfa } from "./mfa.mjs";
export async function adminBrowser(
  page,
  { stepUp = true, operator = true } = {},
) {
  const local = localRuntime();
  const account = await local.verifiedFixtureUser(
    `admin-browser-${randomUUID()}@example.test`,
  );
  if (operator)
    local.sql(
      `insert into private.platform_operators(user_id) values ('${account.userId}')`,
    );
  if (stepUp) await enrollFixtureMfa(account.client);
  const {
    data: { session },
  } = await account.client.auth.getSession();
  // Install once. Reloads must keep the refreshed AAL2 session from real Auth.
  await page.addInitScript(
    ({ key, value }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(value));
    },
    { key: account.client.auth.storageKey, value: session },
  );
  const runtime = {
    ...local.runtime,
    env: {
      ...local.env,
      APP_URL: "http://127.0.0.1:3101",
      ALLOWED_ORIGINS: "http://127.0.0.1:3101",
    },
  };
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      return route.abort();
    const endpoint = url.pathname.match(/^\/functions\/v1\/([a-z-]+)$/)?.[1];
    if (!endpoint) return route.continue();
    const response = await workflowHandler(
      endpoint,
      runtime,
    )(
      new Request(request.url(), {
        method: request.method(),
        headers: request.headers(),
        body: ["GET", "HEAD"].includes(request.method())
          ? undefined
          : request.postData(),
      }),
    );
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  });
  return { local, account };
}
