"use client";
/* Full navigation deliberately clears clinical workspace state. */
/* eslint-disable @next/next/no-html-link-for-pages */
import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DoctorPortal from "./doctor-portal";
import WorkflowShell from "./workflow-shell";
import Invitations from "./invitations-panel";
import Onboarding from "./onboarding-panel";
import Reviews from "./review-panel";
import PractitionerInbox from "./practitioner-panel";
import { getSupabaseBrowserClient } from "./lib/supabase";
import {
  errorText,
  invoke,
  safeDestination,
  type Access,
} from "./lib/workflow";
export default function AuthGate({
  requested,
}: {
  requested?: "invitations" | "onboarding" | "operator" | "practitioner";
}) {
  const client = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [choice, setChoice] = useState("");
  const [loading, setLoading] = useState(Boolean(client));
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const generation = useRef(0);
  const currentUser = useRef<string | null>(null);
  const resolve = useCallback(
    async (next: Session | null) => {
      const run = ++generation.current;
      currentUser.current = next?.user.id || null;
      setSession(next);
      setAccess(null);
      setChoice("");
      setMessage("");
      if (!client || !next) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const result = await invoke<Access>(client, "workspace-access");
        if (generation.current === run) setAccess(result);
      } catch (error) {
        if (generation.current === run) setMessage(errorText(error));
      } finally {
        if (generation.current === run) setLoading(false);
      }
    },
    [client],
  );
  useEffect(() => {
    if (!client) return;
    const lifecycle = generation;
    let active = true;
    let authEvent = false;
    const { data: listener } = client.auth.onAuthStateChange((_event, next) => {
      authEvent = true;
      queueMicrotask(() => {
        if (active) {
          if (next?.user.id && currentUser.current === next.user.id)
            setSession(next);
          else void resolve(next);
        }
      });
    });
    void client.auth.getSession().then(({ data }) => {
      if (active && !authEvent) void resolve(data.session);
    });
    return () => {
      active = false;
      lifecycle.current++;
      listener.subscription.unsubscribe();
    };
  }, [client, resolve]);
  async function signOut() {
    generation.current++;
    currentUser.current = null;
    setAccess(null);
    setChoice("");
    setSession(null);
    const result = await client?.auth.signOut();
    if (result?.error)
      setMessage("Sign-out could not be completed. Please try again.");
  }
  if (preview)
    return (
      <DoctorPortal mode="preview" onExitPreview={() => setPreview(false)} />
    );
  if (loading && session)
    return (
      <WorkflowShell title="Opening your workspace">
        <p role="status">Checking access…</p>
      </WorkflowShell>
    );
  if (!session || !client)
    return (
      <WorkflowShell title="Sign in to your referral workspace">
        <p>
          Access is invitation-only. We’ll email a secure sign-in link to your
          registered address.
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!client) {
              setMessage("The secure backend is not configured in this build.");
              return;
            }
            setBusy(true);
            const destination = safeDestination(window.location.pathname);
            const { error } = await client.auth.signInWithOtp({
              email: email.trim(),
              options: {
                shouldCreateUser: false,
                emailRedirectTo: `${window.location.origin}${destination}`,
              },
            });
            setBusy(false);
            setMessage(
              error
                ? "We could not send the sign-in link. Check your invited account."
                : "Check your email for a secure sign-in link.",
            );
          }}
        >
          <label>
            Work email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button className="button primary" disabled={busy || loading}>
            Email me a sign-in link
          </button>
        </form>
        {message && <p role="status">{message}</p>}
        <hr />
        <button className="button secondary" onClick={() => setPreview(true)}>
          Preview empty workspace
        </button>
        <p>Fictional demo records appear only if you explicitly load them.</p>
      </WorkflowShell>
    );
  if (!access)
    return (
      <WorkflowShell title="Workspace unavailable">
        <p role="alert">{message || "We could not check your access."}</p>
        <button
          className="button secondary"
          onClick={() => void resolve(session)}
        >
          Try again
        </button>
        <button className="button secondary" onClick={() => void signOut()}>
          Sign out
        </button>
      </WorkflowShell>
    );
  const choices = [
    ...access.doctors.map((item) => ({
      id: `doctor:${item.organisationId}`,
      label: `Practice — ${item.organisationName}`,
    })),
    ...access.practitioners.map((item) => ({
      id: `practitioner:${item.practitionerId}`,
      label: `Practitioner — ${item.displayName}`,
    })),
    ...(access.applicationId
      ? [{ id: "onboarding", label: "My practitioner application" }]
      : []),
    ...(access.operator
      ? [{ id: "operator", label: "ReturnWell administration" }]
      : []),
  ];
  const referralDestination =
    typeof window !== "undefined" &&
    /^\/referrals\//.test(window.location.pathname);
  const eligible = choices.filter(
    (item) =>
      (!referralDestination ||
        item.id.startsWith("doctor:") ||
        item.id.startsWith("practitioner:")) &&
      (!requested ||
        (requested === "invitations"
          ? item.id.startsWith("doctor:") || item.id === "operator"
          : item.id.startsWith(requested))),
  );
  const selected = choice || (eligible.length === 1 ? eligible[0].id : "");
  const doctor = access.doctors.find(
    (item) => selected === `doctor:${item.organisationId}`,
  );
  const practitioner = access.practitioners.find(
    (item) => selected === `practitioner:${item.practitionerId}`,
  );
  if (!selected)
    return (
      <WorkflowShell
        title={
          eligible.length
            ? "Choose your workspace"
            : "No workspace is available here"
        }
      >
        <p>Choose the role and practice you want to use.</p>
        <div className="workflow-actions">
          {eligible.map((item) => (
            <button
              key={item.id}
              className="button secondary"
              onClick={() => setChoice(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button className="button secondary" onClick={() => void signOut()}>
          Sign out
        </button>
      </WorkflowShell>
    );
  const navigation = (
    <nav className="workflow-navigation">
      <a href="/">Workspaces</a>
      {doctor && <a href="/invitations">Invitations</a>}
      {access.operator && (
        <a href="/admin/practitioners">Application reviews</a>
      )}
      <button onClick={() => void signOut()}>Sign out</button>
    </nav>
  );
  if (doctor && requested !== "invitations")
    return (
      <DoctorPortal
        key={selected}
        mode="authenticated"
        client={client}
        userId={session.user.id}
        workspace={doctor}
        onSignOut={signOut}
      />
    );
  return (
    <>
      {navigation}
      {requested === "invitations" ? (
        <Invitations
          key={selected}
          client={client}
          organisationId={doctor?.organisationId ?? null}
          organisations={
            selected === "operator"
              ? access.invitationOrganisations || []
              : undefined
          }
          canInviteDoctor={
            selected === "operator" ||
            ["owner", "admin"].includes(doctor?.role || "")
          }
        />
      ) : selected === "onboarding" && access.applicationId ? (
        <Onboarding client={client} applicationId={access.applicationId} />
      ) : selected === "operator" ? (
        <Reviews client={client} />
      ) : practitioner ? (
        <PractitionerInbox
          key={selected}
          client={client}
          practitioner={practitioner}
        />
      ) : (
        <WorkflowShell title="Workspace unavailable">
          <p>This destination is unavailable for the selected account.</p>
        </WorkflowShell>
      )}
    </>
  );
}
