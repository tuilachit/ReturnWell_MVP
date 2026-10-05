import { existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

if (["middleware.ts", "middleware.js"].some((path) => existsSync(resolve(path)))) {
  console.error("Use proxy.ts so Vinext bundles request security; root middleware files trigger Vercel's separate compiler.");
  process.exitCode = 1;
}

const privatePaths = [
  "private-data",
  "research/private-data",
  "app/data/practitioners.generated.json",
  "public/returnwell-import-bundle.json",
];

const present = privatePaths.filter((path) => existsSync(resolve(path)));
// Inspect filenames (including ignored exports), never private file contents.
const excluded = new Set(['node_modules', '.git', '.next', '.vinext', 'dist', '.output', '.vercel', '.wrangler', 'test-results', 'playwright-report']);
function findArtifacts(directory) {
  for (const entry of readdirSync(directory, {withFileTypes:true})) {
    const path = join(directory, entry.name);
    if (/\.candidate-import\.(json|sql)$/.test(entry.name)) present.push(path);
    else if (entry.isDirectory() && !excluded.has(entry.name)) findArtifacts(path);
  }
}
findArtifacts('.');
if (present.length) {
  console.error("Private research data is present. Build from a clean Git checkout; do not deploy this working directory.");
  console.error(present.join("\n"));
  process.exitCode = 1;
}
