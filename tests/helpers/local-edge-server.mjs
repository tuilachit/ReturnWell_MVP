import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { localRuntime } from "./local-runtime.mjs";

// Isolated local stack only. Never load .env.local or call an email provider.
const local = localRuntime();
const cache = join(homedir(), ".cache", "returnwell-local");
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, "returnwell-integration-edge-"));
mkdirSync(join(directory, "supabase"));
cpSync(join(process.env.RW_LOCAL_STACK_DIR, "supabase", "config.toml"), join(directory, "supabase", "config.toml"));
cpSync(new URL("../../supabase/functions/", import.meta.url), join(directory, "supabase", "functions"), { recursive: true, filter: source => !basename(source).startsWith(".env") });
const env = {
  ...local.env,
  ALLOWED_ORIGINS: "http://127.0.0.1:3000,http://localhost:3000",
  EMAIL_DELIVERY_ENABLED: "false",
};
const envFile = join(directory, "local-edge.env");
writeFileSync(envFile, Object.entries(env).map(([key, value]) => `${key}=${value}`).join("\n"), { mode: 0o600 });
const child = spawn("npx", ["--no-install", "supabase", "functions", "serve", "--workdir", directory, "--env-file", envFile], { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", code => { process.exitCode = code || 0; });
