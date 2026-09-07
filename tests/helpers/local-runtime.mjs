import { readFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { workflowHandler } from "../../supabase/functions/_shared/workflow-http.ts";
import { unseal } from "../../supabase/functions/_shared/workflow-security.ts";

const container = "supabase_db_returnwell-integration";
export function localRuntime(directory = process.env.RW_LOCAL_STACK_DIR) {
  if (
    !directory ||
    !basename(resolve(directory)).startsWith("returnwell-integration-")
  )
    throw new Error(
      "An explicitly isolated local stack directory is required.",
    );
  const config = readFileSync(
    join(directory, "supabase", "config.toml"),
    "utf8",
  );
  if (!/^project_id = "returnwell-integration"$/m.test(config))
    throw new Error("Unexpected local project identity.");
  const credentials = JSON.parse(
    readFileSync(join(directory, "local-credentials.json"), "utf8"),
  );
  const apiUrl = credentials.API_URL || credentials.api_url;
  const url = new URL(apiUrl);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.port !== "55321"
  )
    throw new Error("Only the isolated local API at port 55321 is permitted.");
  const publicKey = credentials.ANON_KEY || credentials.PUBLISHABLE_KEY;
  const serviceKey = credentials.SERVICE_ROLE_KEY || credentials.SECRET_KEY;
  if (!publicKey || !serviceKey)
    throw new Error("Local stack credentials are incomplete.");
  let localRequests = 0;
  async function localFetch(input, init) {
    const target = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (target.origin !== url.origin)
      throw new Error("Non-local request blocked by journey harness.");
    localRequests++;
    return fetch(input, init);
  }
  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: localFetch },
  };
  const admin = createClient(apiUrl, serviceKey, options);
  const freshClient = () => createClient(apiUrl, publicKey, options);
  const env = {
    APP_URL: "https://returnwell.example.test",
    ALLOWED_ORIGINS: "https://returnwell.example.test",
    WEBSITE_URL: "https://returnwell.example.test",
    RETURNWELL_BUSINESS_NAME: "Fictional ReturnWell Test Business",
    SUPPORT_EMAIL: "support@example.test",
    TERMS_URL: "https://returnwell.example.test/terms",
    PRIVACY_URL: "https://returnwell.example.test/privacy",
    TERMS_VERSION: "test-terms-v1",
    PRIVACY_VERSION: "test-privacy-v1",
    INVITATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    INVITATION_KEY_ID: "local-journey-only",
  };
  const generatedTypes = [];
  const runtime = {
    env,
    getUser: async (token) => {
      const { data, error } = await admin.auth.getUser(token);
      return error ? null : data.user;
    },
    rpc: async (actor, action, input) => {
      const { data, error } = await admin.rpc("rw_workflow", {
        p_actor: actor,
        p_action: action,
        p_input: input,
      });
      if (error) throw error;
      return data;
    },
    generateLink: async (email, type) => {
      const { data, error } = await admin.auth.admin.generateLink({
        type,
        email,
      });
      if (error || !data.properties?.hashed_token || !data.user?.id)
        throw new Error(
          `Local auth link generation failed: ${error?.code || "unknown"}`,
        );
      generatedTypes.push(type);
      return {
        userId: data.user.id,
        hashedToken: data.properties.hashed_token,
        type,
      };
    },
  };
  function sql(query) {
    // Fixed disposable container. SQL goes over stdin and credentials are never command arguments.
    try {
      return execFileSync(
        "docker",
        [
          "exec",
          "-i",
          container,
          "psql",
          "-X",
          "-q",
          "-A",
          "-t",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "postgres",
        ],
        { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      ).trim();
    } catch {
      throw new Error(
        "Isolated local database query failed; no query or credential contents logged.",
      );
    }
  }
  const uuidSql = (value) => {
    if (!/^[0-9a-f-]{36}$/i.test(value)) throw new Error("Invalid fixture ID");
    return `'${value}'`;
  };
  async function call(endpoint, body = {}, client = null) {
    const session = client
      ? (await client.auth.getSession()).data.session
      : null;
    const headers = { "content-type": "application/json", origin: env.APP_URL };
    if (session) headers.authorization = `Bearer ${session.access_token}`;
    const response = await workflowHandler(
      endpoint,
      runtime,
    )(
      new Request(`http://127.0.0.1:55321/functions/v1/${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: await response.json() };
  }
  async function invitationToken(invitationId) {
    const secret = JSON.parse(
      sql(
        `select jsonb_build_object('envelope',envelope,'context',token_hash) from private.invitation_secrets where invitation_id=${uuidSql(invitationId)}`,
      ),
    );
    return (
      await unseal(
        secret.envelope,
        env.INVITATION_ENCRYPTION_KEY,
        secret.context,
      )
    ).token;
  }
  async function verificationMessage(invitationId) {
    const payload = JSON.parse(
      sql(
        `select payload from private.email_jobs where related_id=${uuidSql(invitationId)} and family='auth_verification' order by created_at desc limit 1`,
      ),
    );
    const email = await unseal(
      payload.envelope,
      env.INVITATION_ENCRYPTION_KEY,
      payload.context,
    );
    const link = email.text.match(
      /^https:\/\/returnwell\.example\.test\/auth\/confirm#[^\s]+$/m,
    )?.[0];
    if (!link)
      throw new Error(
        "Verification message did not contain the expected fragment link.",
      );
    return {
      email,
      values: new URL(link).hash.slice(1),
      attemptId: payload.context,
    };
  }
  async function verify(values) {
    const parsed = new URLSearchParams(values);
    const client = freshClient();
    const { data, error } = await client.auth.verifyOtp({
      token_hash: parsed.get("token_hash"),
      type: parsed.get("type"),
    });
    if (error || !data.user || !data.session)
      throw new Error(
        `Local OTP exchange failed: ${error?.code || "no_session"}`,
      );
    return { client, userId: data.user.id };
  }
  async function verifiedFixtureUser(email) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (error || !data.user)
      throw new Error(
        `Fixture auth creation failed: ${error?.code || "unknown"}`,
      );
    const link = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (link.error)
      throw new Error(
        `Fixture signin link failed: ${link.error.code || "unknown"}`,
      );
    const signedIn = await verify(
      new URLSearchParams({
        token_hash: link.data.properties.hashed_token,
        type: "magiclink",
      }).toString(),
    );
    return signedIn;
  }
  return {
    frontendEnv: { NEXT_PUBLIC_SUPABASE_URL: apiUrl, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey },
    admin,
    freshClient,
    env,
    runtime,
    call,
    sql,
    uuidSql,
    invitationToken,
    verificationMessage,
    verify,
    verifiedFixtureUser,
    generatedTypes,
    requestId: randomUUID,
    requestCount: () => localRequests,
  };
}
