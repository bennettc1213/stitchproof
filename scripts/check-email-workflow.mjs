import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const app = process.env.APP_URL || 'http://127.0.0.1:3000';
const local = (value) => ['localhost', '127.0.0.1'].includes(new URL(value).hostname);
if (
  process.env.NODE_ENV === 'production' ||
  process.env.ALLOW_DEV_SEED !== 'true' ||
  process.env.EMAIL_TRANSPORT !== 'local' ||
  !url ||
  !local(url) ||
  !local(app)
)
  throw new Error(
    'Email checks require explicitly enabled local data and the development file transport.',
  );
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const checked = async (request) => {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data;
};
const before = await checked(
  service
    .from('email_outbox')
    .select('id,state')
    .eq('state', 'queued')
    .lte('next_attempt_at', new Date().toISOString()),
);
assert.equal(
  (
    await fetch(app + '/api/internal/outbox', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-secret' },
    })
  ).status,
  401,
);
let total = 0;
for (let round = 0; round < 20; round++) {
  const batches = await Promise.all(
    [0, 1, 2].map(async () => {
      const response = await fetch(app + '/api/internal/outbox', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + process.env.OUTBOX_WORKER_SECRET },
      });
      assert.equal(response.status, 200);
      return response.json();
    }),
  );
  for (const batch of batches) {
    assert.equal(batch.accepted_by_provider, 0);
    assert.equal(batch.failed, 0);
  }
  const processed = batches.reduce((sum, batch) => sum + batch.processed, 0);
  total += processed;
  if (!processed) break;
}
const after = before.length
  ? await checked(
      service
        .from('email_outbox')
        .select('id,state,payload,error_code')
        .in(
          'id',
          before.map((row) => row.id),
        ),
    )
  : [];
for (const row of after) {
  assert.ok(['development_outbox', 'failed'].includes(row.state));
  assert.deepEqual(row.payload, {});
  if (row.state === 'development_outbox') {
    const message = JSON.parse(await readFile('.local/outbox/' + row.id + '.json', 'utf8'));
    assert.ok(message.notice.includes('No email was sent'));
    assert.equal(typeof message.text, 'string');
  } else
    assert.ok(
      ['link_inactive', 'order_not_ready', 'retry_window_expired'].includes(row.error_code),
    );
}
await writeFile(
  '.local/email-check.json',
  JSON.stringify(
    {
      status: 'passed',
      checked_at: new Date().toISOString(),
      processed: total,
      inspected: after.length,
      scenarios:
        'Unauthorized scheduler denial, parallel authenticated workers, local message files, accurate state and private-payload purging. No provider email was sent.',
    },
    null,
    2,
  ),
);
console.log(
  `Local email checks passed: ${total} messages processed, ${after.length} rows inspected. No provider email was sent.`,
);
