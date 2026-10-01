import { existsSync } from "node:fs";
import { resolve } from "node:path";

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
if (present.length) {
  console.error("Private research data is present. Build from a clean Git checkout; do not deploy this working directory.");
  console.error(present.join("\n"));
  process.exitCode = 1;
}
