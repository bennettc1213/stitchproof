import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { emailConfiguration, emailMessage } from '../src/lib/email';

const db = new PGlite();
const owner = randomUUID(),
  other = randomUUID();
let workspace: string, order: string, file: string;
type Job = {
  id: string;
  lease_id: string;
  attempts: number;
  payload: Record<string, unknown>;
  state: string;
  error_code: string | null;
};
async function user(id: string) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec('set role authenticated');
}
async function system() {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub','',false)");
}
async function rpc<T = unknown>(name: string, args: unknown[] = []) {
  return (
    await db.query<{ result: T }>(
      `select to_jsonb(public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')})) result`,
      args,
    )
  ).rows[0].result;
}
async function claim(): Promise<Job[]> {
  return (await db.query<Job>('select * from claim_outbox(5)')).rows;
}
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    grant execute on function auth.uid() to authenticated,anon,service_role;`);
  for (const name of [
    '202610190001_foundation.sql',
    '202610190003_review_status.sql',
    '202610190004_review_rate_limits.sql',
    '202610190005_team.sql',
    '202610190006_outbox.sql',
  ])
    await db.exec(readFileSync('supabase/migrations/' + name, 'utf8'));
  await db.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [
    owner,
    'owner@example.test',
    other,
    'other@example.test',
  ]);
  await user(other);
  await rpc('onboard_shop', ['Other shop', 'America/Los_Angeles', '']);
  await user(owner);
  workspace = await rpc<string>('onboard_shop', ['Outbox shop', 'America/Los_Angeles', 'Policy']);
  order = await rpc<string>('create_order', [
    'Polos',
    'Alex',
    'alex@example.test',
    '',
    null,
    randomUUID(),
  ]);
  await rpc('save_intake', [
    order,
    0,
    JSON.stringify([{ description: 'Polos', sizes: [{ size: 'M', expected: 24, received: 24 }] }]),
    JSON.stringify({ placement: 'Left chest' }),
    'Initial receipt',
  ]);
  const reserved = await rpc<{ id: string }>('reserve_attachment', [
    order,
    'proof.png',
    'image/png',
    100,
    'proof',
    '',
  ]);
  file = reserved.id;
  await system();
  await rpc('finalize_attachment', [file, 'f'.repeat(64), true]);
});
afterAll(async () => {
  await db.close();
});

test('review email is atomic with its bundle; normal sessions cannot read tokens or claim jobs', async () => {
  await user(owner);
  await rpc('email_proof', [order, 1, [file], 'a'.repeat(64)]);
  const status = await rpc<{ recipient: string; state: string }[]>('outbox_status');
  expect(status).toHaveLength(1);
  expect(status[0].state).toBe('queued');
  expect(status[0].recipient).toBe('alex@example.test');
  expect(JSON.stringify(status)).not.toContain('a'.repeat(64));
  await expect(rpc('claim_outbox', [5])).rejects.toThrow('permission denied');
  await expect(db.query('select payload from email_outbox')).rejects.toThrow('permission denied');
  await expect(rpc('email_proof', [order, 1, [file], 'b'.repeat(64)])).rejects.toThrow(
    'This order changed',
  );
  await user(other);
  expect(await rpc('outbox_status')).toEqual([]);
});

test('leases prevent duplicate claims; retries use bounded backoff and old leases cannot finalize', async () => {
  await system();
  const [job] = await claim();
  expect(job.attempts).toBe(1);
  expect(await claim()).toHaveLength(0);
  expect(
    await rpc('finish_outbox', [job.id, randomUUID(), 'accepted_by_provider', 'provider-id', null]),
  ).toBe(false);
  expect(
    await rpc('finish_outbox', [job.id, job.lease_id, 'failed', null, 'provider_http_503']),
  ).toBe(true);
  expect(await claim()).toHaveLength(0);
  await user(owner);
  await expect(rpc('retry_email', [job.id])).rejects.toThrow('scheduled retry');
  await system();
  await db.query("update email_outbox set next_attempt_at=now()-interval '1 second' where id=$1", [
    job.id,
  ]);
  const [retry] = await claim();
  expect(retry.attempts).toBe(2);
  expect(
    await rpc('finish_outbox', [job.id, job.lease_id, 'accepted_by_provider', 'provider-id', null]),
  ).toBe(false);
  expect(
    await rpc('finish_outbox', [
      job.id,
      retry.lease_id,
      'accepted_by_provider',
      'provider-id',
      null,
    ]),
  ).toBe(true);
  const sent = (await db.query<Job>('select * from email_outbox where id=$1', [job.id])).rows[0];
  expect(sent.state).toBe('accepted_by_provider');
  expect(sent.payload).toEqual({});
  expect(await claim()).toHaveLength(0);
});

test('local messages are recorded accurately; revoked/replaced bearer emails are purged', async () => {
  await user(owner);
  const invitation = await rpc('email_invitation', ['staff@example.test', 'b'.repeat(64)]);
  await system();
  const [job] = await claim();
  expect(await rpc('finish_outbox', [job.id, job.lease_id, 'development_outbox', null, null])).toBe(
    true,
  );
  const local = (await db.query<Job>('select * from email_outbox where id=$1', [job.id])).rows[0];
  expect(local.state).toBe('development_outbox');
  expect(local.payload).toEqual({});
  await user(owner);
  await rpc('revoke_invitation', [invitation]);
  const revoked = await rpc('email_invitation', ['staff@example.test', 'c'.repeat(64)]);
  await rpc('revoke_invitation', [revoked]);
  await rpc('email_proof', [order, 2, [file], 'd'.repeat(64)]);
  await rpc('send_proof', [order, 3, [file], 'e'.repeat(64)]);
  await system();
  expect(await claim()).toHaveLength(0);
  const inactive = (
    await db.query<Job>("select * from email_outbox where error_code='link_inactive'")
  ).rows;
  expect(inactive).toHaveLength(2);
  expect(inactive.every((j) => JSON.stringify(j.payload) === '{}')).toBe(true);
});

test('ready notifications deduplicate; exhausted or old jobs cannot restart the provider window', async () => {
  await system();
  await db.query("update orders set lifecycle='ready_for_pickup' where id=$1", [order]);
  await user(owner);
  const id = await rpc('queue_pickup_notice', [order]);
  expect(await rpc('queue_pickup_notice', [order])).toBe(id);
  await system();
  const [job] = await claim();
  await db.query('update email_outbox set attempts=6 where id=$1', [job.id]);
  await rpc('finish_outbox', [job.id, job.lease_id, 'failed', null, 'provider_http_503']);
  await user(owner);
  await expect(rpc('retry_email', [job.id])).rejects.toThrow('cannot be retried');
  await system();
  await db.query(
    "update email_outbox set first_attempt_at=now()-interval '24 hours',payload=$1 where id=$2",
    [JSON.stringify({ token: 'a'.repeat(64) }), job.id],
  );
  expect(await claim()).toHaveLength(0);
  const expired = (await db.query<Job>('select * from email_outbox where id=$1', [job.id])).rows[0];
  expect(expired.error_code).toBe('retry_window_expired');
  expect(expired.payload).toEqual({});
  expect(
    (
      await db.query('select * from order_events where workspace_id=$1 and kind=$2', [
        workspace,
        'Email attempt failed',
      ])
    ).rows.length,
  ).toBeGreaterThan(0);
});

test('collection before the worker runs cancels a stale pickup notice', async () => {
  await user(owner);
  const pickup = await rpc<string>('create_order', [
    'Pickup check',
    'Alex',
    'alex@example.test',
    '',
    null,
    randomUUID(),
  ]);
  await system();
  await db.query("update orders set lifecycle='ready_for_pickup' where id=$1", [pickup]);
  await user(owner);
  const id = await rpc('queue_pickup_notice', [pickup]);
  await rpc('collect_order', [pickup, 'Alex Morgan', true]);
  await system();
  expect(await claim()).toHaveLength(0);
  const cancelled = (await db.query<Job>('select * from email_outbox where id=$1', [id])).rows[0];
  expect(cancelled.state).toBe('failed');
  expect(cancelled.error_code).toBe('order_not_ready');
  expect(cancelled.payload).toEqual({});
});

test('email configuration rejects production/local bypass; templates use trusted origin and plain text', () => {
  const env = {
    NODE_ENV: 'development',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    EMAIL_TRANSPORT: 'local',
  };
  expect(emailConfiguration(env)).toBe('local');
  expect(() => emailConfiguration({ ...env, NODE_ENV: 'production' })).toThrow(
    'cannot run in production',
  );
  expect(() =>
    emailConfiguration({ ...env, NEXT_PUBLIC_SUPABASE_URL: 'https://remote.supabase.co' }),
  ).toThrow('requires local Supabase');
  expect(emailConfiguration({ EMAIL_TRANSPORT: 'resend' })).toBe('unconfigured');
  const message = emailMessage(
    {
      id: randomUUID(),
      lease_id: randomUUID(),
      recipient: 'alex@example.test',
      template: 'review',
      payload: { token: 'a'.repeat(64), shop: '<script>Example</script>', order_number: 1001 },
    },
    'https://threadproof.example',
  );
  expect(message.text).toContain('https://threadproof.example/review/' + 'a'.repeat(64));
  expect(message).not.toHaveProperty('html');
});
