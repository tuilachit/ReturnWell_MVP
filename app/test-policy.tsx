/* Full navigation keeps these public notices separate from workspace state. */
/* eslint-disable @next/next/no-html-link-for-pages */
import type { ReactNode } from "react";
import WorkflowShell from "./workflow-shell";
import styles from "./test-policy.module.css";

export const testPolicyVersion = "test-draft-2026-10-01";
export const testSupportEmail = "nguyenvanlocdhqt@gmail.com";

export default function TestPolicy({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <WorkflowShell title={title}>
      <article className={styles.copy}>
        <aside className={styles.notice} aria-label="Draft status">
          <strong>Draft for review · Private test only</strong>
          <p>
            ReturnWell Test is a technical test environment, not a launched
            clinical service. Do not enter real patient information. These
            drafts have not been approved for a public or clinical pilot.
          </p>
        </aside>
        <p className={styles.version}>
          Version {testPolicyVersion} · Prepared 1 October 2026
        </p>
        {children}
        <h2>Questions or concerns</h2>
        <p>
          Contact the test organiser at{" "}
          <a href={`mailto:${testSupportEmail}`}>{testSupportEmail}</a>. Do not
          include patient information, passwords or sign-in links in your email.
        </p>
        <nav className={styles.links} aria-label="Test information">
          <a href="/privacy">Privacy notice</a>
          <a href="/terms">Test terms</a>
          <a href="/">Back to ReturnWell</a>
        </nav>
      </article>
    </WorkflowShell>
  );
}
