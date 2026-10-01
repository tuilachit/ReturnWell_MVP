"use client";
import { Component, type ReactNode } from "react";
export default class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="workflow-page">
        <section className="workflow-content" role="alert">
          <h1>This screen could not be displayed</h1>
          <p>
            Reload to recover saved work. Unsaved edits may be lost. If a send
            was in progress, check the referral list before submitting again.
          </p>
          <button
            className="button secondary"
            onClick={() => window.location.reload()}
          >
            Reload workspace
          </button>
        </section>
      </main>
    );
  }
}
