import assert from "node:assert/strict";
import test from "node:test";

const cron = await import("../app/api/cron/dispatch-email-jobs/route.ts").catch(
  () => ({}),
);

const savedEnv = new Map();
async function withEnv(values, fn) {
  savedEnv.clear();
  for (const key of ["CRON_SECRET", "SUPABASE_URL", "EMAIL_WORKER_SECRET"]) {
    savedEnv.set(key, process.env[key]);
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("cron route rejects requests without the configured cron secret", async () => {
  assert.equal(typeof cron.GET, "function", "cron route must be implemented");
  let calls = 0;
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("worker must not be called");
  };
  try {
    await withEnv(
      {
        CRON_SECRET: "cron-secret",
        SUPABASE_URL: "https://project.supabase.co",
        EMAIL_WORKER_SECRET: "worker-secret",
      },
      async () => {
        const response = await cron.GET(
          new Request("https://returnwell.example/api/cron/dispatch-email-jobs"),
        );
        assert.equal(response.status, 401);
        assert.equal(calls, 0);
      },
    );
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test("cron route fails closed when worker configuration is missing", async () => {
  const response = await withEnv(
    {
      CRON_SECRET: "cron-secret",
      SUPABASE_URL: "",
      EMAIL_WORKER_SECRET: "worker-secret",
    },
    () => cron.GET(
      new Request("https://returnwell.example/api/cron/dispatch-email-jobs", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    ),
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Email worker unavailable" });
});

test("cron route forwards an authenticated bounded dispatch request", async () => {
  const priorFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ processed: 1, sent: 1 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const response = await withEnv(
      {
        CRON_SECRET: "cron-secret",
        SUPABASE_URL: "https://project.supabase.co/",
        EMAIL_WORKER_SECRET: "worker-secret",
      },
      () => cron.GET(
        new Request("https://returnwell.example/api/cron/dispatch-email-jobs", {
          headers: { authorization: "Bearer cron-secret" },
        }),
      ),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      result: { processed: 1, sent: 1 },
    });
    assert.equal(
      request.url,
      "https://project.supabase.co/functions/v1/dispatch-email-jobs",
    );
    assert.equal(request.options.method, "POST");
    assert.equal(request.options.headers.authorization, "Bearer worker-secret");
    assert.deepEqual(JSON.parse(request.options.body), { limit: 20 });
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test("cron route sanitizes worker failures", async () => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("provider details must not leak", { status: 500 });
  try {
    const response = await withEnv(
      {
        CRON_SECRET: "cron-secret",
        SUPABASE_URL: "https://project.supabase.co",
        EMAIL_WORKER_SECRET: "worker-secret",
      },
      () => cron.GET(
        new Request("https://returnwell.example/api/cron/dispatch-email-jobs", {
          headers: { authorization: "Bearer cron-secret" },
        }),
      ),
    );
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "Email worker unavailable" });
  } finally {
    globalThis.fetch = priorFetch;
  }
});
