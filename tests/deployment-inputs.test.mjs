import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/check-deployment-inputs.mjs", import.meta.url));

test("deployment preflight permits a clean source export", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "returnwell-deploy-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

for (const filename of ["middleware.ts", "middleware.js"]) {
  test(`deployment preflight blocks Vercel's separate compiler for ${filename}`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "returnwell-deploy-test-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(join(root, filename), 'import { NextResponse } from "next/server";');
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Use proxy\.ts.*Vinext/);
  });
}

test("deployment preflight permits the Vinext proxy entry", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "returnwell-deploy-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "proxy.ts"), 'import { NextResponse } from "next/server";');
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

for (const filename of [
  "private-data/fixture.json",
  "app/data/practitioners.generated.json",
  "public/returnwell-import-bundle.json",
  "research/private-data/fixture.json",
]) {
  test(`deployment preflight refuses ${filename} without printing its contents`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "returnwell-deploy-test-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const destination = join(root, filename);
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, "FICTIONAL_PRIVATE_RECORD_DO_NOT_PRINT");
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Private research data is present/);
    assert.doesNotMatch(result.stderr + result.stdout, /FICTIONAL_PRIVATE_RECORD_DO_NOT_PRINT/);
  });
}
