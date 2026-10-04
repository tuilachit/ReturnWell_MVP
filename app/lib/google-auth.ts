import { safeDestination } from "./workflow.ts";

export function googleSignInEnabled() {
  return process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";
}

// Google is entered with a full document navigation. Its single SDK client uses
// PKCE; other documents keep the existing cross-device email-link flow. Do not
// replace that navigation with an SPA transition or create a second Auth client.
export function browserAuthOptions(path: string) {
  return {
    flowType: path === "/auth/google" ? ("pkce" as const) : ("implicit" as const),
    detectSessionInUrl: !["/auth/google", "/auth/confirm"].includes(path),
  };
}

type GoogleReturn =
  | { kind: "start"; destination: string }
  | { kind: "callback"; destination: string; code: string; flowId?: string }
  | { kind: "error"; destination: string; message: string };

export function googleReturn(search: string, hash: string): GoogleReturn {
  const params = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const next = safeDestination(params.get("next") || "/");
  // Invitation confirmation requires its original in-memory verification
  // context. Never carry an invitation token through a third-party redirect.
  const destination = next === "/auth/confirm" ? "/" : next;
  if (
    [params, fragment].some(
      (value) => value.has("error") || value.has("error_description") || value.has("error_code"),
    )
  ) {
    return {
      kind: "error",
      destination,
      message: [params, fragment].some((value) => value.get("error") === "access_denied")
        ? "Google sign-in was cancelled. Try again or use your email sign-in link."
        : "Google sign-in could not be completed. Try again or use your email sign-in link.",
    };
  }
  const code = params.get("code");
  if (
    code && code.length <= 2048 && params.getAll("code").length === 1 &&
    params.getAll("sb_flow_id").length <= 1 && !hash
  ) {
    return {
      kind: "callback", destination, code,
      flowId: params.get("sb_flow_id") ?? undefined,
    };
  }
  if (params.get("start") === "1" && !params.has("code") && !hash) {
    return { kind: "start", destination };
  }
  return {
    kind: "error", destination,
    message: "This sign-in link is incomplete or has expired. Start again or use your email sign-in link.",
  };
}
