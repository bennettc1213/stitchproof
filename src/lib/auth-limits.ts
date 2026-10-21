import 'server-only';
import { admin } from './supabase/admin';
import { authIdentityDigest, type AuthAction } from './auth-limit-policy';

export async function enforceAuthLimit(action: AuthAction, email: string) {
  let result: { allowed: boolean; retry_after: number };
  try {
    const digest = authIdentityDigest(action, email, process.env.AUTH_RATE_LIMIT_SECRET || '');
    const { data, error } = await admin().rpc('consume_auth_attempt', {
      p_action: action,
      p_digest: digest,
    });
    if (error || typeof data?.allowed !== 'boolean' || !Number.isFinite(data.retry_after))
      throw new Error('Invalid limit response');
    result = data;
  } catch {
    // Never continue to the provider when the shared guard is unavailable.
    throw new Error('Authentication is temporarily unavailable. Please try again later.');
  }
  if (!result.allowed) {
    const seconds = Math.max(1, Math.min(3600, Math.ceil(result.retry_after)));
    const amount = seconds >= 60 ? Math.ceil(seconds / 60) : seconds;
    const unit = seconds >= 60 ? 'minute' : 'second';
    throw new Error(
      `Too many authentication attempts. Try again in about ${amount} ${unit}${amount === 1 ? '' : 's'}.`,
    );
  }
}
