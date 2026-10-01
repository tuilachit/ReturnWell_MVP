"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import WorkflowShell from "./workflow-shell";
import Field from "./components/field";
export default function SecurityPanel({ client }: { client: SupabaseClient }) {
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [verified, setVerified] = useState(false),
    [code, setCode] = useState(""),
    [factorId, setFactorId] = useState("");
  const [incomplete, setIncomplete] = useState<{ id: string }[]>([]);
  const [setup, setSetup] = useState<{
    id: string;
    qr: string;
    secret: string;
  } | null>(null);
  const lock = useRef(false),
    alive = useRef(true);
  const load = useCallback(async () => {
    const [factors, assurance] = await Promise.all([
      client.auth.mfa.listFactors(),
      client.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    if (factors.error || assurance.error) throw Error("load");
    if (!alive.current) return;
    setVerified(assurance.data.currentLevel === "aal2");
    setFactorId(factors.data.totp[0]?.id || "");
    setIncomplete(
      factors.data.all.filter(
        (f) => f.factor_type === "totp" && f.status === "unverified",
      ),
    );
    setLoading(false);
  }, [client]);
  useEffect(() => {
    alive.current = true;
    void load().catch(() => {
      if (alive.current) {
        setError("Account security could not be loaded. Try again.");
        setLoading(false);
      }
    });
    return () => {
      alive.current = false;
    };
  }, [load]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      if (alive.current)
        setError(
          "We could not complete verification. Check the current code in your authenticator and try again. If setup is unavailable, contact ReturnWell support.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <WorkflowShell title="Account security" compact>
      <p>
        Use an authenticator app to protect practice administration and
        professional reviews.
      </p>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">Checking security settings…</p>
      ) : verified ? (
        <p role="status">Verified for privileged actions in this session.</p>
      ) : (
        <p role="status">
          Authenticator verification required for privileged actions.
        </p>
      )}
      {!loading && !verified && !factorId && !setup && (
        <button
          className="button primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await client.auth.mfa.enroll({
                factorType: "totp",
                friendlyName: `ReturnWell ${new Date().toISOString()}`,
              });
              if (result.error) throw result.error;
              if (alive.current)
                setSetup({
                  id: result.data.id,
                  qr: result.data.totp.qr_code,
                  secret: result.data.totp.secret,
                });
            })
          }
        >
          Set up authenticator
        </button>
      )}
      {setup && (
        <section aria-label="Authenticator setup">
          <h2>Add ReturnWell to your authenticator</h2>
          <p>
            Scan this QR code, or enter the setup key manually. Keep this key
            private.
          </p>
          {/* Supabase-generated data image; never inserted as executable SVG/HTML. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={setup.qr}
            alt="Authenticator setup QR code"
            width={200}
            height={200}
          />
          <Field id="mfa-setup-key" label="Setup key">
            {(props) => (
              <input
                {...props}
                value={setup.secret}
                readOnly
                autoComplete="off"
              />
            )}
          </Field>
        </section>
      )}
      {!loading && !verified && (setup || factorId) && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const result = await client.auth.mfa.challengeAndVerify({
                factorId: setup?.id || factorId,
                code,
              });
              if (result.error) throw result.error;
              if (alive.current) {
                setSetup(null);
                setCode("");
                await load();
              }
            });
          }}
        >
          <Field
            id="mfa-code"
            label="Authenticator code"
            hint="Enter the current six-digit code from your app."
          >
            {(props) => (
              <input
                {...props}
                required
                pattern="[0-9]{6}"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={busy}
              />
            )}
          </Field>
          <div className="workflow-actions">
            <button className="button primary" disabled={busy}>
              {busy ? "Verifying…" : "Verify authenticator"}
            </button>
            {setup && (
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await client.auth.mfa.unenroll({
                      factorId: setup.id,
                    });
                    if (result.error) throw result.error;
                    if (alive.current) {
                      setSetup(null);
                      setCode("");
                      await load();
                    }
                  })
                }
              >
                Cancel setup
              </button>
            )}
          </div>
        </form>
      )}
      {!setup && incomplete.length > 0 && (
        <section aria-label="Incomplete authenticator setups">
          <h2>Incomplete setup</h2>
          <p>
            A previous setup was not verified. Discard it before starting again
            if you no longer have its key.
          </p>
          {incomplete.map((factor, index) => (
            <button
              key={factor.id}
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await client.auth.mfa.unenroll({
                    factorId: factor.id,
                  });
                  if (result.error) throw result.error;
                  await load();
                })
              }
            >
              Discard incomplete setup {index + 1}
            </button>
          ))}
        </section>
      )}
      <details>
        <summary>Lost access to your authenticator?</summary>
        <p>
          Contact ReturnWell through your existing support channel for an
          independent identity check. Signing in by email does not bypass
          privileged verification. Do not send anyone your setup key or
          verification code.
        </p>
      </details>
      {error && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void run(load)}
        >
          Reload security settings
        </button>
      )}
    </WorkflowShell>
  );
}
