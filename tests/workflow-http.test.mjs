import assert from "node:assert/strict";
import test from "node:test";
const api =
  await import("../supabase/functions/_shared/workflow-http.ts").catch(
    () => ({}),
  );
const base = {
  env: {
    APP_URL: "https://returnwell.example.test",
    ALLOWED_ORIGINS: "https://returnwell.example.test",
  },
  getUser: async () => null,
  rpc: async () => {
    throw Error("RPC should not be reached");
  },
};
test('committed directory sends attempt their own invitation and refresh durable status',async()=>{
  const operations=[];
  const invited='00000000-0000-4000-8000-000000000042',referral='00000000-0000-4000-8000-000000000043';
  const handle=api.workflowHandler('manage-referral',{...base,env:{...base.env,INVITATION_ENCRYPTION_KEY:btoa('a'.repeat(32)),INVITATION_KEY_ID:'test'},getUser:async()=>({id:'doctor'}),rpc:async(actor,action,input)=>{
    operations.push({actor,action,input});
    if(action==='email.claimScoped')return [];
    return {invitationId:invited,referralId:referral,invitationNotification:action==='growth.status'?'paused_configuration':'pending'};
  }});
  const response=await handle(new Request('https://api.example.test',{method:'POST',headers:{authorization:'Bearer verified'},body:JSON.stringify({operation:'draft.directoryInvite',id:referral,selection:{routeId:'selected'},scope:{family:'referral',relatedId:'forged'},recipientEmail:'forged@example.test'})}));
  assert.equal(response.status,200);
  assert.deepEqual(operations.map(x=>x.action),['growth.directoryInvite','email.claimScoped','growth.status']);
  assert.deepEqual(operations[1].input.scope,{family:'invitation',relatedId:invited});
  assert.equal(operations[1].actor,null);
  assert.equal((await response.json()).invitationNotification,'paused_configuration');
});
test('member finalisation retains a committed referral if immediate dispatch fails',async()=>{
  const calls=[],id='00000000-0000-4000-8000-000000000043';
  const handle=api.workflowHandler('manage-referral',{...base,getUser:async()=>({id:'doctor'}),rpc:async(_actor,action,input)=>{
    calls.push([action,input]);if(action==='email.claimScoped')throw Error('queue unavailable SECRET');return {id,status:'sent'};
  }});
  const response=await handle(new Request('https://api.example.test',{method:'POST',headers:{authorization:'Bearer verified'},body:JSON.stringify({operation:'draft.finalize',id,scope:{family:'invitation',relatedId:'forged'}})}));
  assert.equal(response.status,200);assert.equal((await response.json()).id,id);
  assert.deepEqual(calls[1][1].scope,{family:'referral',relatedId:id});
});
test('source and patient-contact errors are actionable pre-commit rejections',async()=>{
  for(const code of ['recipient_changed','invalid_patient_contact','directory_selection_required']){
    const handle=api.workflowHandler('manage-referral',{...base,getUser:async()=>({id:'trusted-user'}),rpc:async()=>{throw Error(code+' SECRET SQL');}});
    const response=await handle(new Request('https://api.example.test',{method:'POST',headers:{authorization:'Bearer verified'},body:JSON.stringify({operation:'draft.save'})}));
    assert.equal(response.status,400);assert.equal((await response.json()).code,code);
  }
});
test("a lost RPC response after commit is ambiguous, not a definite rejection", async () => {
  let committed = false;
  const handle = api.workflowHandler("manage-referral", {
    ...base,
    getUser: async () => ({ id: "trusted-user" }),
    rpc: async () => {
      committed = true;
      throw new TypeError("fetch failed SECRET");
    },
  });
  const response = await handle(
    new Request("https://api.example.test", {
      method: "POST",
      headers: { authorization: "Bearer verified" },
      body: JSON.stringify({
        operation: "replace",
        referralId: "00000000-0000-4000-8000-000000000001",
        expectedVersion: 1,
        requestId: "00000000-0000-4000-8000-000000000002",
      }),
    }),
  );
  assert.equal(committed, true);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "request_failed");
  assert.doesNotMatch(JSON.stringify(body), /SECRET|fetch failed/);
});
test("email diagnostics use current authenticated actor and cannot dispatch transport actions", async () => {
  const calls = [];
  const handle = api.workflowHandler("email-operations", {
    ...base,
    getUser: async () => ({ id: "verified-operator" }),
    rpc: async (...args) => {
      calls.push(args);
      return { jobs: [] };
    },
  });
  const request = (body) =>
    new Request("https://api.example.test", {
      method: "POST",
      headers: { authorization: "Bearer verified" },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await handle(
        request({
          operation: "list",
          actor: "victim",
          limit: 25,
          providerId: "secret",
        }),
      )
    ).status,
    200,
  );
  assert.deepEqual(calls, [
    ["verified-operator", "operations.email", { limit: 25 }],
  ]);
  assert.equal(
    (await handle(request({ operation: "email.claim" }))).status,
    400,
  );
  assert.equal(calls.length, 1);
});
test("rate limits expose Retry-After across the configured browser origin", async () => {
  const handle = api.workflowHandler("workspace-access", {
    ...base,
    getUser: async () => ({ id: "trusted-user" }),
    rpc: async () => {
      throw Error("rate_limited SECRET");
    },
  });
  const response = await handle(
    new Request("https://api.example.test", {
      method: "POST",
      headers: { authorization: "Bearer verified", origin: base.env.APP_URL },
      body: "{}",
    }),
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(
    response.headers.get("access-control-expose-headers"),
    "Retry-After",
  );
  assert.doesNotMatch(await response.text(), /SECRET/);
});
test("claim recovery takes actor from verified session and accepts no recipient or token override", async () => {
  const calls = [];
  const handle = api.workflowHandler("claim-invitation", {
    ...base,
    getUser: async () => ({ id: "trusted-user" }),
    rpc: async (...args) => {
      calls.push(args);
      return { attempts: [] };
    },
  });
  const response = await handle(
    new Request("https://api.example.test", {
      method: "POST",
      headers: { authorization: "Bearer verified" },
      body: JSON.stringify({
        operation: "recovery",
        actor: "victim",
        recipientEmail: "victim@example.test",
        token: "secret",
      }),
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [["trusted-user", "invitation.recovery", {}]]);
});
test("directory failures expose safe actionable codes, never SQL details", async () => {
  for (const code of ["invalid_cursor", "geography_unavailable", "invalid_location", "invalid_radius", "location_required"]) {
    const handle = api.workflowHandler("search-practitioners", {
      ...base,
      getUser: async () => ({ id: "trusted-user" }),
      rpc: async () => {
        throw Error(code + " SECRET SQL details");
      },
    });
    const response = await handle(
      new Request("https://api.example.test", {
        method: "POST",
        headers: { authorization: "Bearer verified" },
        body: "{}",
      }),
    );
    const body = await response.json();
    assert.equal(body.code, code);
    assert.equal(response.status, 400);
    assert.equal(JSON.stringify(body).includes("SECRET"), false);
  }
});
test("HTTP origin, method, session and size checks fail before database actions", async () => {
  assert.equal(
    typeof api.workflowHandler,
    "function",
    "HTTP security boundary must be implemented",
  );
  const handle = api.workflowHandler("workspace-access", base);
  assert.equal(
    (await handle(new Request("https://api.example.test", { method: "GET" })))
      .status,
    405,
  );
  assert.equal(
    (
      await handle(
        new Request("https://api.example.test", {
          method: "POST",
          headers: { origin: "https://evil.test" },
          body: "{}",
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handle(
        new Request("https://api.example.test", { method: "POST", body: "{}" }),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await handle(
        new Request("https://api.example.test", {
          method: "POST",
          body: JSON.stringify({ large: "x".repeat(17000) }),
        }),
      )
    ).status,
    413,
  );
  const options = await handle(
    new Request("https://api.example.test", {
      method: "OPTIONS",
      headers: { origin: "https://returnwell.example.test" },
    }),
  );
  assert.equal(options.status, 204);
  assert.equal(
    options.headers.get("access-control-allow-origin"),
    "https://returnwell.example.test",
  );
});
test("authenticated endpoint cannot dispatch arbitrary service-only actions or trust request actor", async () => {
  assert.equal(typeof api.workflowHandler, "function");
  const calls = [];
  const handle = api.workflowHandler("manage-invitations", {
    ...base,
    getUser: async () => ({ id: "trusted-user" }),
    rpc: async (...args) => {
      calls.push(args);
      return { invitations: [] };
    },
  });
  const response = await handle(
    new Request("https://api.example.test", {
      method: "POST",
      headers: { authorization: "Bearer verified" },
      body: JSON.stringify({
        operation: "list",
        organisationId: null,
        actorId: "victim",
        tokenHash: "attacker",
      }),
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    [
      "trusted-user",
      "invitations.list",
      {
        organisationId: null,
      },
    ],
  ]);
  assert.equal(
    (
      await handle(
        new Request("https://api.example.test", {
          method: "POST",
          headers: { authorization: "Bearer verified" },
          body: '{"operation":"email.claim"}',
        }),
      )
    ).status,
    400,
  );
});
test("public invitation inspection cannot create an account or expose server credential fields", async () => {
  assert.equal(typeof api.workflowHandler, "function");
  const calls = [];
  const handle = api.workflowHandler("invitation-entry", {
    ...base,
    env: {
      ...base.env,
      RETURNWELL_BUSINESS_NAME: "Fictional",
      SUPPORT_EMAIL: "support@example.test",
      WEBSITE_URL: "https://returnwell.example.test",
      PRIVACY_URL: "https://returnwell.example.test/privacy",
      TERMS_URL: "https://returnwell.example.test/terms",
      TERMS_VERSION: "v1",
      PRIVACY_VERSION: "v1",
    },
    rpc: async (...args) => {
      calls.push(args);
      return { invitationId: "opaque-id", maskedEmail: "a***@example.test" };
    },
    generateLink: () => {
      throw Error("must not generate on inspection");
    },
  });
  const res = await handle(
    new Request("https://api.example.test", {
      method: "POST",
      body: JSON.stringify({
        operation: "inspect",
        token: "a".repeat(43),
        email: "attacker@test",
        redirectTo: "https://evil.test",
      }),
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], "invitation.inspect");
  assert.deepEqual(Object.keys(calls[0][2]), ["tokenHash"]);
  assert.doesNotMatch(await res.text(), /attacker|evil.test|tokenHash/);
});
test("linked invitation HTTP keeps actor and token material server owned", async () => {
  const calls = [];
  const runtime = {
    env: {
      APP_URL: "https://returnwell.example",
      INVITATION_ENCRYPTION_KEY: btoa("a".repeat(32)),
      INVITATION_KEY_ID: "local-test",
    },
    getUser: async () => ({ id: "verified-actor", aal: "aal1" }),
    rpc: async (actor, action, input) => {
      calls.push({ actor, action, input });
      return { referralId: "safe-id" };
    },
  };
  const response = await api.workflowHandler(
    "manage-referral",
    runtime,
  )(
    new Request("https://local.test", {
      method: "POST",
      headers: {
        authorization: "Bearer fixture",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        operation: "draft.invite",
        id: "draft-id",
        expectedVersion: 0,
        requestId: "request",
        consentConfirmed: true,
        contactConsentConfirmed: true,
        contactBasis: "recipient_requested",
        recipientEmail: "recipient@example.test",
        recipientName: "Fictional",
        actor: "forged",
        tokenHash: "forged",
        envelope: "forged",
      }),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(calls[0].actor, "verified-actor");
  assert.equal(calls[0].action, "growth.invite");
  assert.match(calls[0].input.tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(calls[0].input.envelope, "forged");
  assert.equal(calls[0].input.actor, undefined);
});
