import { randomUUID } from "node:crypto";
import { localRuntime } from "./local-runtime.mjs";
import { workflowHandler } from "../../supabase/functions/_shared/workflow-http.ts";
import { credentialFixtureSql } from "./credential-fixture.mjs";

// Real local Auth + PostgREST + workflow handler; no hosted APIs or mail provider.
export async function doctorBrowser(
  page,
  { dropFinalResponseOnce = false, actor = "doctor" } = {},
) {
  const local = localRuntime();
  const doctor = await local.verifiedFixtureUser(
    `draft-browser-${randomUUID()}@example.test`,
  );
  const org = randomUUID();
  const owner = await local.verifiedFixtureUser(
    `credential-browser-${randomUUID()}@example.test`,
  );
  const practitioner = randomUUID();
  const clinic = `Fictional Draft Clinic ${practitioner.slice(0, 8)}`;
  local.sql(`insert into public.organisations(id,name) values ('${org}','Fictional Draft Practice');
    insert into public.organisation_memberships(organisation_id,user_id,role) values ('${org}','${doctor.userId}','referrer');
    insert into public.practitioners(id,display_name,profession,practice_name,contact_email,lifecycle_status,ahpra_registration_number,ahpra_verification_status,ahpra_verified_at,provider_confirmation_status,provider_confirmed_at,accepting_new_referrals,telehealth,services,funding,languages)
    values ('${practitioner}','Fictional Draft Receiver','physiotherapist','${clinic}','receiver@example.test','active','BROWSER${practitioner.replaceAll("-", "")}','verified',now(),'confirmed',now(),true,true,array['Physiotherapy'],array['Medicare'],array['English']);`);
  local.sql(
    credentialFixtureSql({
      practitionerId: practitioner,
      ownerId: owner.userId,
      reviewerId: doctor.userId,
      organisationId: org,
    }),
  );
  const {
    data: { session },
  } = await (
    actor === "practitioner" ? owner : doctor
  ).client.auth.getSession();
  const storageKey = (actor === "practitioner" ? owner : doctor).client.auth
    .storageKey;
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: storageKey, value: session },
  );
  const runtime = {
    ...local.runtime,
    env: {
      ...local.env,
      APP_URL: "http://127.0.0.1:3101",
      ALLOWED_ORIGINS: "http://127.0.0.1:3101",
      EMAIL_DELIVERY_ENABLED: "false",
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
    if (
      dropFinalResponseOnce &&
      endpoint === "manage-referral" &&
      request.postDataJSON()?.operation === "draft.finalize" &&
      response.ok
    ) {
      dropFinalResponseOnce = false;
      return route.abort("failed");
    }
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  });
  return {
    local,
    doctor,
    owner,
    organisationId: org,
    practitionerId: practitioner,
    clinic,
  };
}
