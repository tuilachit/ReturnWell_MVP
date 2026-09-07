# Referral Workspace Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the existing ReturnWell GP referral prototype into a restrained sidebar-based operational workspace while preserving its complete interactive workflow.

**Architecture:** Keep the existing single client component and state model, but wrap all views in a persistent sidebar/workspace shell. Derive the three dashboard groups from the already-filtered referral collection and express the new visual system in the existing global stylesheet so no new runtime dependency is required.

**Tech Stack:** React 19, TypeScript, Vinext, Lucide React, CSS, Node test runner

**Spec:** `docs/superpowers/specs/2026-09-03-referral-workspace-redesign.md`

## Global Constraints

- Preserve all current referral workflow interactions and fictional-data warnings.
- Show only working ReturnWell destinations in the sidebar.
- Do not change product metadata or the existing social preview.
- Add no runtime dependency.
- Use neutral visual styling and reserve colour for functional state.

---

### Task 1: Lock the workspace structure into the rendered contract

**Files:**
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: server-rendered HTML from `dist/server/index.js`
- Produces: a regression contract for `.gp-sidebar`, `Referral workspace`, `Needs attention`, `In progress`, and `Completed`

- [ ] **Step 1: Write the failing test**

Add assertions to the portal rendering test:

```js
assert.match(html, /class="gp-sidebar"/);
assert.match(html, /Referral workspace/);
assert.match(html, /Needs attention/);
assert.match(html, /In progress/);
assert.match(html, /Completed/);
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run build && node --test --test-name-pattern="server-renders" tests/rendered-html.test.mjs`

Expected: FAIL because the current page has no `.gp-sidebar` or grouped referral sections.

- [ ] **Step 3: Keep the failing test in place**

Do not weaken the assertions or match implementation-only JavaScript source.

---

### Task 2: Implement the persistent shell and grouped referral dashboard

**Files:**
- Modify: `app/doctor-portal.tsx`
- Test: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: `view`, `search`, `statusFilter`, `filteredReferrals`, `startReferral`, `goHome`, and `openReferral`
- Produces: `referralGroups: Array<{ label: string; description: string; items: Referral[] }>` and the persistent `.gp-sidebar` / `.gp-workspace` markup

- [ ] **Step 1: Derive the dashboard groups**

Create a memoized collection after `filteredReferrals`:

```tsx
const referralGroups = useMemo(() => [
  { label: "Needs attention", description: "No response or another option required", items: filteredReferrals.filter((item) => item.attention) },
  { label: "In progress", description: "Sent, accepted or awaiting patient choice", items: filteredReferrals.filter((item) => !item.attention && item.status !== "Appointment booked") },
  { label: "Completed", description: "The referral resulted in a booking", items: filteredReferrals.filter((item) => item.status === "Appointment booked") },
], [filteredReferrals]);
```

- [ ] **Step 2: Replace the top navigation with the persistent shell**

Add a semantic `<aside className="gp-sidebar">`, black primary action, controlled search field, working navigation buttons, and practice identity. Wrap the existing views in `<div className="gp-workspace">` with a compact workspace header.

- [ ] **Step 3: Replace the flat recent-referrals table with grouped sections**

Render each `referralGroups` item as an open `<details className="referral-group">`. Preserve patient reference, need, provider, status, update time, and the working detail action for every row. Render an explicit empty row when a filter leaves a group empty.

- [ ] **Step 4: Run the focused rendered test**

Run: `npm run build && node --test --test-name-pattern="server-renders" tests/rendered-html.test.mjs`

Expected: PASS with the new shell and all three group labels in rendered HTML.

---

### Task 3: Apply the restrained reference-inspired visual system

**Files:**
- Modify: `app/globals.css`
- Test: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: the class names added by Task 2
- Produces: desktop sidebar layout, broad summary/group panels, dense referral rows, and responsive compact navigation

- [ ] **Step 1: Define the neutral tokens and desktop shell**

Set the page background to light grey, establish a 250px sidebar column, style the primary action black, and keep workspace content within a readable maximum width.

- [ ] **Step 2: Style summary and referral groups**

Use one broad grey summary panel, simple dividers, 14-16px body text, and compact grid rows. Use muted status colours only for dots and warnings.

- [ ] **Step 3: Restyle the existing form, shortlist, review, sent, and detail views**

Carry panel backgrounds, button language, input rounding, spacing, and typography through every existing view without altering handlers or validation.

- [ ] **Step 4: Add responsive behavior**

At tablet widths, turn the fixed sidebar into a compact horizontal header and allow dense data rows to scroll. At phone widths, stack summary items, forms, and actions without hiding labels or controls.

- [ ] **Step 5: Run lint**

Run: `npm run lint`

Expected: exit code 0 with no ESLint errors.

---

### Task 4: Verify the complete local artifact

**Files:**
- Verify: `app/doctor-portal.tsx`
- Verify: `app/globals.css`
- Verify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: the completed implementation
- Produces: fresh evidence for build, rendered contract, fictional-data safeguards, and metadata preservation

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: build exit code 0 and all rendered HTML tests pass.

- [ ] **Step 2: Run lint after the final code state**

Run: `npm run lint`

Expected: exit code 0 with no ESLint errors.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff -- app/doctor-portal.tsx app/globals.css tests/rendered-html.test.mjs docs/superpowers`

Expected: only the approved shell, styling, tests, and planning documentation are changed.

- [ ] **Step 4: Confirm requirement coverage**

Check the implementation against all six acceptance criteria in the spec and report any remaining gap instead of claiming completion.
