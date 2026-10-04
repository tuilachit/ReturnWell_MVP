"use client";
/* Full document navigation isolates OAuth's PKCE client from email callbacks. */
import { useEffect, useRef, useState } from "react";
import { googleReturn, googleSignInEnabled } from "../../lib/google-auth";
import { getSupabaseBrowserClient } from "../../lib/supabase";
import WorkflowShell from "../../workflow-shell";

type Result = { message: string; destination: string };

async function continueGoogle(): Promise<Result | null> {
  const input = googleReturn(window.location.search, window.location.hash);
  const { destination } = input;
  try {
    // Remove codes and provider error details before async work. Never log them.
    window.history.replaceState(window.history.state, "", "/auth/google");
    if (input.kind === "error") return input;
    const client = getSupabaseBrowserClient();
    if (!client) return {
      destination,
      message: "The secure backend is not configured. Please contact your practice administrator.",
    };
    if (input.kind === "start") {
      if (!googleSignInEnabled()) return {
        destination,
        message: "Google sign-in is not available yet. Please use your email sign-in link.",
      };
      const callback = new URL("/auth/google", window.location.origin);
      callback.searchParams.set("next", destination);
      const { data, error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callback.toString(),
          scopes: "openid email profile",
          queryParams: { prompt: "select_account" },
          skipBrowserRedirect: true,
        },
      });
      if (error || !data.url) throw new Error("OAuth could not start");
      window.location.replace(data.url);
      return null;
    }
    const { data, error } = await client.auth.exchangeCodeForSession(
      input.code,
      input.flowId ? { flowId: input.flowId } : undefined,
    );
    // An old persisted session is not proof this callback succeeded. Only the
    // successful exchange can continue; AuthGate then checks database access.
    if (error || !data.session) throw new Error("OAuth exchange failed");
    window.location.replace(destination);
    return null;
  } catch {
    return {
      destination,
      message: "Google sign-in could not be completed. Start again in this browser, or use your email sign-in link.",
    };
  }
}

export default function GoogleAuthPage() {
  const operation = useRef<Promise<Result | null> | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    let active = true;
    // React Strict Mode must not start or exchange the one-use code twice.
    operation.current ??= continueGoogle();
    void operation.current.then((value) => {
      if (active) setResult(value);
    });
    return () => { active = false; };
  }, []);
  return (
    <WorkflowShell
      title={result ? "Sign-in not completed" : "Signing in with Google"}
      compact
    >
      {result ? (
        <>
          <p role="alert">{result.message}</p>
          <div className="workflow-actions">
            {googleSignInEnabled() && (
              <a
                className="button primary"
                href={`/auth/google?start=1&next=${encodeURIComponent(result.destination)}`}
              >Try Google again</a>
            )}
            <a className="button secondary" href={result.destination}>Use email instead</a>
          </div>
        </>
      ) : <p role="status">Completing secure sign-in…</p>}
      <p className="hint">
        Sign-in does not grant practice access. Your invitation and workspace permissions still apply.
      </p>
    </WorkflowShell>
  );
}
