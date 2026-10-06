import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { localRuntime } from "./local-runtime.mjs";
import { workflowHandler } from "../../supabase/functions/_shared/workflow-http.ts";
import { credentialFixtureSql } from "./credential-fixture.mjs";

// The shared directory is now paginated. Find the fictional recipient through
// real controls instead of assuming every prior test's record fits on page one.
export async function selectFixturePractitioner(page, clinic) {
  const choice = page.getByRole("radio", { name: new RegExp(clinic) });
  for (let n = 0; n < 100; n++) {
    await page.getByRole("radio").first().waitFor({ state: "visible" });
    if (await choice.count()) {
      await choice.check();
      return;
    }
    const next = page.getByRole("button", { name: "Next page", exact: true });
    if (!(await next.isEnabled())) {
      const remote=page.getByRole('button',{name:/^Telehealth-only options/});
      if(await remote.count()&&await remote.getAttribute('aria-pressed')!=='true'){
        await remote.click();
        continue;
      }
      throw Error("Fictional recipient absent from directory");
    }
    // These radios use React state and have no HTML value attribute ("on").
    // Wait for a real visible recipient label change after pagination.
    const previous = await page
      .getByRole("radio")
      .first()
      .locator("..")
      .innerText();
    await next.click();
    await expect
      .poll(async () =>
        page.getByRole("radio").first().locator("..").innerText(),
      )
      .not.toBe(previous);
  }
  throw Error("Fictional directory exceeded bounded test search");
}

// Real local Auth + PostgREST + workflow handler; no hosted APIs or mail provider.
export async function doctorBrowser(
  page,
  {
    dropFinalResponseOnce = false,
    dropTransitionResponseOnce = false,
    dropInvitationResponseOnce = false,
    failInvitationBeforeCommitOnce = false,
    dropReconfirmResponseOnce = false,
    dropClaimResponseOnce = false,
    dropPractitionerResponseOnce = false,
    loseRpcResponseOnceFor = null,
    holdReplacementResponse = false,
    seedSession = true,
    actor = "doctor",
  } = {},
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
  if (seedSession)
    await page.context().addInitScript(
      ({ key, value }) => {
        if (!localStorage.getItem(key))
          localStorage.setItem(key, JSON.stringify(value));
      },
      { key: storageKey, value: session },
    );
  const runtime = {
    ...local.runtime,
    env: {
      ...local.env,
      APP_URL: local.env.APP_URL,
      ALLOWED_ORIGINS: "http://127.0.0.1:3101",
      EMAIL_DELIVERY_ENABLED: "false",
    },
    rpc: async (...args) => {
      const result = await local.runtime.rpc(...args);
      if (args[1] === loseRpcResponseOnceFor) {
        loseRpcResponseOnceFor = null;
        throw new TypeError("Fictional lost RPC response after commit");
      }
      return result;
    },
  };
  let releaseReplacement;
  const replacementHold = new Promise((resolve) => {
    releaseReplacement = resolve;
  });
  const handleRoute = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      return route.abort();
    const endpoint = url.pathname.match(/^\/functions\/v1\/([a-z-]+)$/)?.[1];
    if (!endpoint) return route.continue();
    if (failInvitationBeforeCommitOnce && endpoint === 'manage-referral' && request.postDataJSON()?.operation === 'draft.directoryInvite') {
      failInvitationBeforeCommitOnce = false;
      return route.abort('failed');
    }
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
      holdReplacementResponse &&
      endpoint === "manage-referral" &&
      request.postDataJSON()?.operation === "replace"
    ) {
      await replacementHold;
    }
    if (
      dropPractitionerResponseOnce &&
      endpoint === "respond-to-referral" &&
      response.ok
    ) {
      dropPractitionerResponseOnce = false;
      return route.abort("failed");
    }
    if (
      dropClaimResponseOnce &&
      endpoint === "claim-invitation" &&
      !request.postDataJSON()?.operation &&
      response.ok
    ) {
      dropClaimResponseOnce = false;
      return route.abort("failed");
    }
    if (
      dropInvitationResponseOnce &&
      endpoint === "manage-referral" &&
      ["draft.invite","draft.directoryInvite"].includes(request.postDataJSON()?.operation) &&
      response.ok
    ) {
      dropInvitationResponseOnce = false;
      return route.abort("failed");
    }
    if (
      dropReconfirmResponseOnce &&
      endpoint === "manage-referral" &&
      request.postDataJSON()?.operation === "onboarding.reconfirm" &&
      response.ok
    ) {
      dropReconfirmResponseOnce = false;
      return route.abort("failed");
    }
    if (
      dropFinalResponseOnce &&
      endpoint === "manage-referral" &&
      request.postDataJSON()?.operation === "draft.finalize" &&
      response.ok
    ) {
      dropFinalResponseOnce = false;
      return route.abort("failed");
    }
    if (
      dropTransitionResponseOnce &&
      endpoint === "manage-referral" &&
      request.postDataJSON()?.operation === "transition" &&
      response.ok
    ) {
      dropTransitionResponseOnce = false;
      return route.abort("failed");
    }
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  };
  await page.context().route("**/*", handleRoute);
  await page.route("**/*", handleRoute);
  return {
    local,
    runtime,
    doctor,
    owner,
    organisationId: org,
    practitionerId: practitioner,
    clinic,
    releaseReplacement,
  };
}
