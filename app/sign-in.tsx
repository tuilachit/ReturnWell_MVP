"use client";
/* Full navigation keeps public notices separate from workspace state. */

import { ArrowRight, ChevronRight, Mail } from "./ui-icons";
import { useSyncExternalStore, type FormEvent } from "react";
import { Brand, BrandMark } from "./brand";
import AccountFooter from "./account-footer";
import Field from "./components/field";

type Props = {
  email: string;
  setEmail: (value: string) => void;
  busy: boolean;
  loading: boolean;
  message: string;
  googleEnabled: boolean;
  onGoogle: () => void;
  retryAfterSeconds?: number;
  onSubmit: (event: FormEvent) => void | Promise<void>;
  onPreview: () => void;
};
const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export default function SignIn({
  email,
  setEmail,
  busy,
  loading,
  message,
  googleEnabled,
  onGoogle,
  retryAfterSeconds = 0,
  onSubmit,
  onPreview,
}: Props) {
  // Server-rendered controls must not accept clicks before React attaches them.
  const hydrated = useSyncExternalStore(subscribe, clientReady, serverReady);
  return (
    <main className="sign-in-page">
      <header className="sign-in-header">
        <Brand />
        <span className="pilot-tag">Private test</span>
      </header>
      <section className="sign-in-panel" aria-labelledby="sign-in-heading">
        <BrandMark className="sign-in-app-icon" />
        <h1 id="sign-in-heading">Welcome to ReturnWell</h1>
        <p className="sign-in-description">
          Sign in to your referral workspace.
        </p>
        <button
          type="button"
          className="button secondary full google-sign-in"
          onClick={onGoogle}
          disabled={!hydrated || busy || loading || !googleEnabled}
          aria-describedby={!googleEnabled ? "google-availability" : undefined}
        >Continue with Google</button>
        {!googleEnabled && <p id="google-availability" className="sign-in-provider-note">Google sign-in is not available yet. Use email below.</p>}
        <div className="sign-in-divider"><span>or use email</span></div>
        <form onSubmit={onSubmit}>
          <Field id="work-email" label="Work email">
            {(fieldProps) => (
              <div className="email-input">
                <Mail size={18} aria-hidden="true" />
                <input
                  {...fieldProps}
                  type="email"
                  autoComplete="email"
                  required
                  disabled={!hydrated || busy || loading}
                  placeholder="you@yourpractice.com.au"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
            )}
          </Field>
          <button
            className="button primary full"
            disabled={!hydrated || busy || loading || retryAfterSeconds > 0}
          >
            {busy
              ? "Sending your link…"
              : retryAfterSeconds > 0
                ? `Try again in ${retryAfterSeconds}s`
                : "Email me a sign-in link"}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </form>
        {message && (
          <p className="auth-message" role="status">
            {message}
          </p>
        )}
        <p className="sign-in-invitation">
          New here? Sign in, then choose your account type.
          <br />
          Already invited? Use the email address on your invitation.
        </p>
        <div className="preview-entry">
          <button
            onClick={onPreview}
            disabled={!hydrated}
            aria-label="Preview empty workspace"
          >
            Explore the workspace <ChevronRight size={16} aria-hidden="true" />
          </button>
          <p>Preview only. Nothing is saved or sent.</p>
        </div>
      </section>
      <AccountFooter />
    </main>
  );
}
