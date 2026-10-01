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
}: {
  title: string;
  children: ReactNode;
  compact?: boolean;
  step?: 1 | 2 | 3;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [title]);
  return (
    <main className="workflow-page">
      <header>
        <a className="auth-brand" href="/">
          <Brand />
        </a>
        <span className="pilot-tag">Private test</span>
      </header>
      <section className={`workflow-content${compact ? " workflow-content-compact" : ""}`} aria-labelledby="workflow-title">
        <a className="workflow-home" href="/">
          <ArrowLeft size={15} /> Back to workspace
        </a>
        {step && (
          <ol className="account-progress" aria-label="Account setup">
            {["Invitation", "Verify email", "Complete setup"].map((label, index) => (
              <li key={label} aria-current={step === index + 1 ? "step" : undefined}>
                <span>{String(index + 1).padStart(2, "0")}</span> {label}
              </li>
            ))}
          </ol>
        )}
        <h1 id="workflow-title" ref={heading} tabIndex={-1}>
          {title}
        </h1>
        {children}
      </section>
      <AccountFooter />
    </main>
  );
}
