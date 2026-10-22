import { z } from 'zod';

// Database functions raise user-facing messages with SQLSTATE P0001 (plain RAISE EXCEPTION).
// Other database and billing-provider errors can expose table, constraint, or account details,
// so they are logged on the server and replaced with a generic message.
export function userError(error: unknown, fallback: string): string {
  if (error instanceof z.ZodError) return error.issues.map((issue) => issue.message).join(' ');
  const detail = (error ?? {}) as { message?: unknown; code?: unknown; type?: unknown };
  const message = typeof detail.message === 'string' ? detail.message : '';
  const code = typeof detail.code === 'string' ? detail.code : '';
  const databaseError =
    /^[0-9A-Z]{5}$/.test(code) && typeof error === 'object' && error !== null && 'details' in error;
  const providerError = typeof detail.type === 'string' && detail.type.startsWith('Stripe');
  if (!message || (databaseError && code !== 'P0001') || providerError) {
    console.error('Unexpected action error', {
      code: code || undefined,
      type: detail.type,
      message,
    });
    return fallback;
  }
  return message;
}
