import 'server-only';
import { createHash } from 'node:crypto';
import { admin } from './supabase/admin';
export async function reviewAccess(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('This review link is inactive.');
  const digest = createHash('sha256').update(token).digest('hex');
  const service = admin();
  const { data, error } = await service.rpc('consume_review_limit', {
    p_digest: digest,
  });
  if (error || !data)
    throw new Error('Too many review attempts. Please wait a minute and try again.');
  return { service, digest };
}
