import { createHmac } from 'node:crypto';

export type AuthAction = 'login' | 'signup' | 'forgot';
export function authLimitsConfigured(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const secret = env.AUTH_RATE_LIMIT_SECRET;
  return Boolean(secret && secret.length >= 32 && secret.length <= 4096);
}
export function authIdentityDigest(action: AuthAction, email: string, secret: string) {
  if (!authLimitsConfigured({ AUTH_RATE_LIMIT_SECRET: secret }))
    throw new Error('Authentication limit secret is unavailable.');
  return createHmac('sha256', secret)
    .update('threadproof-auth\0' + action + '\0' + email.trim().toLowerCase())
    .digest('hex');
}
