import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
// Git can enumerate ignored inputs without opening their contents. Exclude
// dependency/build tooling only; public/ and source folders are never skipped.
const ignored = execFileSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', '.', ':!:node_modules', ':!:.git', ':!:.next', ':!:.vinext', ':!:dist', ':!:.output', ':!:.vercel', ':!:.wrangler', ':!:test-results', ':!:playwright-report'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const unsafe = name => /(^|\/)(private-data|local-credentials\.json)(\/|$)/.test(name)
  || /\.candidate-import\.(json|sql)$/.test(name)
  || /(^|\/)\.env($|\.)/.test(name) && !name.endsWith('.env.example')
  || /\.(pem|key|p12|pfx)$/.test(name)
  || ['app/data/practitioners.generated.json', 'public/returnwell-import-bundle.json'].includes(name);
const found = [...tracked, ...ignored].filter(unsafe);
for (const name of ['private-data', 'research/private-data', '.env.local', 'supabase/functions/.env', 'local-credentials.json', 'app/data/practitioners.generated.json', 'public/returnwell-import-bundle.json']) {
  if (existsSync(name) && !found.includes(name)) found.push(name);
}
if (found.length) {
  console.error(`Unsafe release input: ${found.join(', ')}`);
  process.exitCode = 1;
} else if (untracked.length) {
  console.error('Untracked files are not reviewed release inputs. Stage the intended source or use a clean checkout.');
  process.exitCode = 1;
} else {
  const files = {};
  for (const name of tracked.sort()) {
    if (!existsSync(name) || !lstatSync(name).isFile()) {
      console.error('Release input must be an existing regular file.');
      process.exit(1);
    }
    files[name] = createHash('sha256').update(readFileSync(name)).digest('hex');
  }
  console.log(JSON.stringify({ format: 1, files }, null, 2));
}
