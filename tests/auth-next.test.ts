import { expect, test } from 'vitest';
import { authNext } from '../src/lib/auth-next';

test('auth redirects preserve invitations and recovery while rejecting arbitrary destinations', () => {
  const invitation = '/invite/' + 'a'.repeat(64);
  expect(authNext(invitation)).toBe(invitation);
  expect(authNext('/reset-password')).toBe('/reset-password');
  for (const value of [
    'https://example.com',
    '//example.com',
    '/invite/invalid',
    '/invite/' + 'a'.repeat(64) + '?next=https://example.com',
    null,
    ['/reset-password'],
  ]) {
    expect(authNext(value)).toBe('/app/orders');
  }
});
