import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { userError } from '../src/lib/user-error';

const fallback = 'Please retry.';
const database = (code: string, message: string) => ({ code, message, details: '', hint: '' });

describe('userError', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});

  it('shows messages raised for users by database functions', () => {
    expect(userError(database('P0001', 'This order was changed by someone else.'), fallback)).toBe(
      'This order was changed by someone else.',
    );
  });

  it('hides internal database errors', () => {
    expect(
      userError(
        database('23505', 'duplicate key value violates unique constraint "customers_email_key"'),
        fallback,
      ),
    ).toBe(fallback);
    expect(
      userError(database('42501', 'permission denied for table billing_accounts'), fallback),
    ).toBe(fallback);
  });

  it('hides billing provider errors', () => {
    const stripe = Object.assign(new Error("No such price: 'price_123'"), {
      type: 'StripeInvalidRequestError',
    });
    expect(userError(stripe, fallback)).toBe(fallback);
  });

  it('keeps validation and application messages', () => {
    const parsed = z.email().safeParse('nope');
    expect(userError(parsed.error, fallback)).toMatch(/email/i);
    expect(userError(new Error('Owner access required.'), fallback)).toBe('Owner access required.');
  });

  it('falls back when there is no message', () => {
    expect(userError(undefined, fallback)).toBe(fallback);
    expect(userError('text', fallback)).toBe(fallback);
  });
});
