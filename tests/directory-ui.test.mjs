import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const cacheDir = await mkdtemp(join(tmpdir(), "returnwell-directory-test-"));
const server = await createServer({
  configFile: false,
  cacheDir,
  plugins: [react()],
  server: { middlewareMode: true },
  appType: "custom",
});
after(async () => {
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
});
const { default: Directory } = await server.ssrLoadModule("/app/practitioner-directory.tsx");
const { default: DirectoryPages } = await server.ssrLoadModule("/app/components/directory-pages.tsx");
test("radius claims apply only to the nearby group, never unknown or telehealth", () => {
  const page = {
    items: [], totalEligible: 0, nextCursor: null,
    groupCounts: { local: 0, unknown: 0, remote: 0 },
    geography: { origin: { suburb: "Fictional Origin", postcode: "2000", hasCoordinates: true }, radiusKm: 10 },
  };
  const renderGroup = (group) => renderToStaticMarkup(createElement(DirectoryPages, {
    page, group, busy: false, hasCursor: false, onGroup() {}, onNext() {}, onFirst() {},
  }));
  assert.match(renderGroup("local"), /within 10 km/);
  for (const group of ["unknown", "remote"]) {
    const html = renderGroup(group);
    assert.doesNotMatch(html, /within 10 km/);
    assert.match(html, /not limited by the selected radius/);
  }
});
const render = (error = "") => renderToStaticMarkup(createElement(Directory, {
  practitioners: [], loading: false, preview: false, demo: false, error,
  onDemo() {}, onRefer() {}, onRetry() {},
}));

test("failed directory loading cannot be mistaken for a successful empty result", () => {
  const html = render("Could not load this workspace. Try again.");
  assert.match(html, /role="alert"/);
  assert.match(html, /Could not load this workspace/);
  assert.match(html, /Try again/);
  assert.doesNotMatch(html, /No practitioners yet|0 available/);
});

test("a successful empty directory still explains how practitioners become available", () => {
  const html = render();
  assert.match(html, /No practitioners yet/);
  assert.doesNotMatch(html, /role="alert"/);
});
