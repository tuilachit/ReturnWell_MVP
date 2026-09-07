"use client";
/* Full navigation deliberately clears clinical workspace state. */
/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useRef, type ReactNode } from "react";
export default function WorkflowShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [title]);
  return (
    <main className="workflow-page">
      <header>
        <a className="auth-brand" href="/">
          <span>R</span>
          <strong>ReturnWell</strong>
        </a>
        <a href="/">Workspaces</a>
      </header>
      <section className="workflow-content">
        <h1 ref={heading} tabIndex={-1}>
          {title}
        </h1>
        {children}
      </section>
    </main>
  );
}
