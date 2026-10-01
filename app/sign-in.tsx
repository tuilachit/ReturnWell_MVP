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
        <form onSubmit={onSubmit}>
          <Field id="work-email" label="Work email">{fieldProps => <div className="email-input">
            <Mail size={18} aria-hidden="true" />
            <input
              {...fieldProps}
              type="email"
              autoComplete="email"
              required
              placeholder="you@yourpractice.com.au"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>}</Field>
          <button className="button primary full" disabled={!hydrated || busy || loading}>
            {busy ? "Sending your link…" : "Email me a sign-in link"}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </form>
        {message && (
          <p className="auth-message" role="status">
            {message}
          </p>
        )}
        <p className="sign-in-invitation">
          Use the email address your practice invited.
          <br />
          We’ll send a sign-in link. No password needed.
        </p>
        <div className="preview-entry">
          <button onClick={onPreview} disabled={!hydrated} aria-label="Preview empty workspace">
            Explore the workspace <ChevronRight size={16} aria-hidden="true" />
          </button>
          <p>Preview only. Nothing is saved or sent.</p>
        </div>
      </section>
      <AccountFooter />
    </main>
  );
}
