import 'server-only';
import { emailConfiguration } from './email';
import { billingConfiguration } from './billing-domain';
export function configured() {
  emailConfiguration();
  billingConfiguration();
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SEED === 'true')
    throw new Error('Development seeding cannot be enabled in production.');
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
export function appOrigin() {
  const url = new URL(process.env.APP_URL || 'http://127.0.0.1:3000');
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password)
    throw new Error('APP_URL must be an origin.');
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
    throw new Error('Production APP_URL must use HTTPS.');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid APP_URL.');
  return url.origin;
}
