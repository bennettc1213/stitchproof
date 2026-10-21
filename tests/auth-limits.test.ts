import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { authIdentityDigest, authLimitsConfigured } from '../src/lib/auth-limit-policy';
const db = new PGlite();
const digest = (value: string) =>
  authIdentityDigest('login', value, 'synthetic-unit-secret-'.repeat(3));
const consume = async (action: string, identity: string) =>
  (
    await db.query<{ result: { allowed: boolean; retry_after: number } }>(
      'select consume_auth_attempt($1,$2) result',
      [action, identity],
    )
  ).rows[0].result;
beforeAll(async () => {
  await db.exec(
    'create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;',
  );
  await db.exec(readFileSync('supabase/migrations/202610210013_auth_limits.sql', 'utf8'));
});
afterAll(async () => {
  await db.close();
});
test('identity keys normalize email and separate action/secret namespaces without storing addresses', () => {
  expect(digest(' PERSON@EXAMPLE.TEST ')).toBe(digest('person@example.test'));
  expect(digest('person@example.test')).toMatch(/^[0-9a-f]{64}$/);
  expect(
    authIdentityDigest('forgot', 'person@example.test', 'synthetic-unit-secret-'.repeat(3)),
  ).not.toBe(digest('person@example.test'));
  expect(
    authIdentityDigest('login', 'person@example.test', 'other-synthetic-secret-'.repeat(3)),
  ).not.toBe(digest('person@example.test'));
  expect(authLimitsConfigured({})).toBe(false);
  expect(() => authIdentityDigest('login', 'person@example.test', 'short')).toThrow('secret');
});
test('login attempts share a bounded ten-minute counter; another identity remains available', async () => {
  for (let index = 0; index < 10; index++)
    expect((await consume('login', digest('limited@example.test'))).allowed).toBe(true);
  const denied = await consume('login', digest('limited@example.test'));
  expect(denied.allowed).toBe(false);
  expect(denied.retry_after).toBeGreaterThan(0);
  expect(denied.retry_after).toBeLessThanOrEqual(600);
  expect((await consume('login', digest('other@example.test'))).allowed).toBe(true);
  await consume('login', digest('limited@example.test'));
  expect(
    (
      await db.query<{ hits: number }>(
        'select hits from auth_attempt_limits where scope=$1 and digest=$2',
        ['identity', digest('limited@example.test')],
      )
    ).rows[0].hits,
  ).toBe(11);
});
test('signup/recovery limits and rollovers are independent and return bounded retry times', async () => {
  for (const [action, window] of [
    ['signup', 3600],
    ['forgot', 900],
  ] as const) {
    const key = digest(action + '@example.test');
    for (let index = 0; index < 3; index++) expect((await consume(action, key)).allowed).toBe(true);
    const denied = await consume(action, key);
    expect(denied.allowed).toBe(false);
    expect(denied.retry_after).toBeLessThanOrEqual(window);
    await db.query(
      "update auth_attempt_limits set window_start=window_start-interval '1 hour' where scope='identity' and digest=$1",
      [key],
    );
    expect((await consume(action, key)).allowed).toBe(true);
  }
});
test('bounded expiry cleanup removes old counters and invalid arguments are rejected', async () => {
  const key = digest('expired@example.test');
  await db.query(
    "insert into auth_attempt_limits values('login','identity',$1,now()-interval '3 hours',1)",
    [key],
  );
  await consume('login', digest('cleanup@example.test'));
  expect(
    (await db.query('select * from auth_attempt_limits where digest=$1', [key])).rows,
  ).toHaveLength(0);
  await expect(consume('login', 'person@example.test')).rejects.toThrow('Invalid');
  await expect(consume('unknown', key)).rejects.toThrow('Invalid');
});
test('global ceiling is checked before creating another identity bucket', async () => {
  await db.query("update auth_attempt_limits set hits=300 where action='login' and scope='global'");
  const key = digest('global-denied@example.test');
  const result = await consume('login', key);
  expect(result.allowed).toBe(false);
  expect(result.retry_after).toBeLessThanOrEqual(60);
  expect(
    (await db.query('select * from auth_attempt_limits where digest=$1', [key])).rows,
  ).toHaveLength(0);
});
test('anonymous and authenticated clients cannot read counters or invoke the server-only guard', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec('reset role; set role ' + role);
    await expect(consume('login', digest('forbidden@example.test'))).rejects.toThrow(
      'permission denied',
    );
    await expect(db.query('select * from auth_attempt_limits')).rejects.toThrow(
      'permission denied',
    );
  }
  await db.exec('reset role; set role service_role');
  expect((await consume('forgot', digest('service@example.test'))).allowed).toBe(true);
});
