import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

if (process.env.NODE_ENV === 'production') throw new Error('Local setup cannot run in production.');
let text = await readFile(existsSync('.env.local') ? '.env.local' : '.env.example', 'utf8');
const get = (key) => text.match(new RegExp('^' + key + '=(.*)$', 'm'))?.[1]?.trim();
const local = (value) => ['127.0.0.1', 'localhost'].includes(new URL(value).hostname);
if (get('NEXT_PUBLIC_SUPABASE_URL') && !local(get('NEXT_PUBLIC_SUPABASE_URL')))
  throw new Error('Existing configuration points to remote Supabase; refusing to overwrite it.');
const taskEnv = { ...process.env };
if (process.platform === 'win32') {
  const taskDocker = path.join(
    process.env.ProgramFiles || 'C:\\Program Files',
    'Docker',
    'Docker',
    'resources',
    'bin',
  );
  if (existsSync(taskDocker)) taskEnv.PATH = taskDocker + path.delimiter + process.env.PATH;
}
let status;
try {
  status = JSON.parse(
    execFileSync(
      process.execPath,
      ['node_modules/supabase/dist/supabase.js', 'status', '--output', 'json'],
      { encoding: 'utf8', env: taskEnv, stdio: ['ignore', 'pipe', 'pipe'] },
    ),
  );
} catch {
  throw new Error(
    'Cannot read local Supabase status. Start Docker and run pnpm db:start first. No keys were printed.',
  );
}
if (!status.API_URL || !local(status.API_URL) || !status.ANON_KEY || !status.SERVICE_ROLE_KEY)
  throw new Error(
    'Local Supabase did not return the required URL/keys. Configuration was not changed.',
  );
const values = {
  APP_URL: 'http://127.0.0.1:3000',
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  ALLOW_DEV_SEED: 'false',
  EMAIL_TRANSPORT:
    !get('EMAIL_TRANSPORT') || get('EMAIL_TRANSPORT') === 'unconfigured'
      ? 'local'
      : get('EMAIL_TRANSPORT'),
  OUTBOX_WORKER_SECRET: get('OUTBOX_WORKER_SECRET') || randomBytes(32).toString('hex'),
  AUTH_RATE_LIMIT_SECRET: get('AUTH_RATE_LIMIT_SECRET') || randomBytes(32).toString('hex'),
};
for (const [key, value] of Object.entries(values)) {
  const expression = new RegExp('^' + key + '=.*$', 'm');
  text = expression.test(text)
    ? text.replace(expression, () => key + '=' + value)
    : text + '\n' + key + '=' + value + '\n';
}
await writeFile('.env.local', text, { mode: 0o600 });
console.log(
  'Local Supabase configuration saved to ignored .env.local. Development email uses local files; no messages are sent. Restart the app after configuration changes.',
);
