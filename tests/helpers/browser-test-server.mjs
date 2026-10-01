import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { browserSettings } from './browser-test-config.mjs';

if (readdirSync('.').some(name => name.startsWith('.env') && name !== '.env.example')) {
  throw new Error('Browser tests require an isolated checkout without environment files.');
}
const { env } = browserSettings();
if (process.env.RW_LOCAL_STACK_DIR) {
  const { localRuntime } = await import('./local-runtime.mjs');
  Object.assign(env, localRuntime().frontendEnv);
}
const child = spawn(process.execPath, ['node_modules/vinext/dist/cli.js', 'dev', '--hostname', '127.0.0.1', '--port', '3101'], { stdio: 'inherit', env });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });
