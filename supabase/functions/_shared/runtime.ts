import { createClient } from "npm:@supabase/supabase-js@2.114.0";
import type { WorkflowRuntime } from "./workflow-http.ts";
export function runtime(): WorkflowRuntime {
  const env = Deno.env.toObject();
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
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
      if (
        error || !data.properties?.hashed_token || !data.user?.id
      ) throw Error("auth_link_failed");
      return {
        userId: data.user.id,
        hashedToken: data.properties.hashed_token,
        type,
      };
    },
  };
}
