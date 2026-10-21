import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { admin } from '@/lib/supabase/admin';
import { appOrigin } from '@/lib/config';
import { emailConfiguration, emailMessage, type EmailJob } from '@/lib/email';
import { authorizedWorker } from '@/lib/worker-auth';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!authorizedWorker(request)) return new Response('Unauthorized', { status: 401 });
  try {
    const transport = emailConfiguration();
    if (transport === 'unconfigured')
      return Response.json({ status: 'email-not-configured' }, { status: 503 });
    const service = admin();
    const { data, error } = await service.rpc('claim_outbox', { p_limit: 5 });
    if (error) throw error;
    const counts = { processed: 0, accepted_by_provider: 0, development_outbox: 0, failed: 0 };
    for (const job of (data || []) as EmailJob[]) {
      let state = 'failed',
        provider: string | null = null,
        code: string | null = null;
      try {
        const message = emailMessage(job, appOrigin());
        if (transport === 'local') {
          if (!/^[a-f0-9-]{36}$/.test(job.id)) throw new Error('Invalid job ID.');
          await mkdir(path.join(process.cwd(), '.local', 'outbox'), { recursive: true });
          await writeFile(
            path.join(process.cwd(), '.local', 'outbox', job.id + '.json'),
            JSON.stringify(
              { notice: 'Development outbox only. No email was sent.', ...message },
              null,
              2,
            ),
            { mode: 0o600 },
          );
          state = 'development_outbox';
        } else {
          const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            signal: AbortSignal.timeout(8000),
            headers: {
              Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
              'Content-Type': 'application/json',
              'Idempotency-Key': 'threadproof/' + job.id,
            },
            body: JSON.stringify({ from: process.env.EMAIL_FROM, ...message }),
          });
          if (response.ok) {
            const result = await response.json();
            if (typeof result.id === 'string' && result.id.length > 0) {
              state = 'accepted_by_provider';
              provider = result.id;
            } else code = 'provider_missing_reference';
          } else code = 'provider_http_' + response.status;
        }
      } catch {
        code = 'transport_or_message_error';
      }
      const finished = await service.rpc('finish_outbox', {
        p_id: job.id,
        p_lease: job.lease_id,
        p_state: state,
        p_provider: provider,
        p_error: code,
      });
      if (finished.error || !finished.data) throw new Error('Could not finalize delivery state.');
      counts.processed++;
      counts[state as 'failed' | 'accepted_by_provider' | 'development_outbox']++;
    }
    return Response.json(counts, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json(
      { status: 'worker-unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
