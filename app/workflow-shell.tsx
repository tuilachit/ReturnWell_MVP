"use client";
/* Full navigation deliberately clears clinical workspace state. */
/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useRef, type ReactNode } from "react";
import { Brand } from "./brand";
import { ArrowLeft } from "./ui-icons";
import AccountFooter from "./account-footer";
export default function WorkflowShell({
  title,
  children,
  compact = false,
  step,
  recipient = false,
  eyebrow,
  aside,
}: {
  title: string;
  children: ReactNode;
  compact?: boolean;
  step?: 1 | 2 | 3;
  recipient?: boolean;
  eyebrow?: string;
  aside?: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [title]);
  const progress = step && (
    <ol className="account-progress" aria-label="Account setup">
      {["Invitation", "Verify email", "Complete setup"].map((label, index) => (
        <li key={label} aria-current={step === index + 1 ? "step" : undefined}>
          <span>{String(index + 1).padStart(2, "0")}</span> {label}
        </li>
      ))}
    </ol>
  );
  if (recipient)
    return (
      <main className="workflow-page recipient-page">
        <header>
          <a className="auth-brand" href="/" aria-label="ReturnWell home">
            <Brand />
          </a>
          <span className="recipient-header-caption">Practice connections</span>
          <div className="recipient-header-actions">
            <span className="pilot-tag">Private test</span>
            <a href="/support">Help &amp; support</a>
          </div>
        </header>
        <div
          className={`recipient-frame${compact && !aside ? " recipient-frame-compact" : ""}`}
        >
          {progress}
          <div
            className={`recipient-columns${aside ? " recipient-columns-with-aside" : ""}`}
          >
            <section
              className="workflow-content"
              aria-labelledby="workflow-title"
            >
              {eyebrow && <p className="recipient-eyebrow">{eyebrow}</p>}
              <h1 id="workflow-title" ref={heading} tabIndex={-1}>
                {title}
              </h1>
              {children}
            </section>
            {aside && (
              <aside
                className="recipient-aside"
                aria-label="About your invitation"
              >
                {aside}
              </aside>
            )}
          </div>
        </div>
        <AccountFooter plain />
      </main>
    );
  return (
    <main className="workflow-page">
      <header>
        <a className="auth-brand" href="/">
          <Brand />
        </a>
        <span className="pilot-tag">Private test</span>
      </header>
      <section
        className={`workflow-content${compact ? " workflow-content-compact" : ""}`}
        aria-labelledby="workflow-title"
      >
        <a className="workflow-home" href="/">
          <ArrowLeft size={15} /> Back to workspace
        </a>
        {progress}
        <h1 id="workflow-title" ref={heading} tabIndex={-1}>
          {title}
        </h1>
        {children}
      </section>
      <AccountFooter />
    </main>
  );
}
