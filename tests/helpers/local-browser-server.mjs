import { spawn } from "node:child_process";
import { localRuntime } from "./local-runtime.mjs";
const local = localRuntime();
const child = spawn("npx", ["--no-install", "vinext", "dev", "--hostname", "127.0.0.1", "--port", "3000"], { stdio: "inherit", env: { ...process.env, ...local.frontendEnv, NEXT_PUBLIC_EMAIL_DELIVERY_ENABLED: "false" } });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", code => { process.exitCode = code || 0; });
