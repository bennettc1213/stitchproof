import { admin } from '@/lib/supabase/admin';
import { authorizedWorker } from '@/lib/worker-auth';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!authorizedWorker(request)) return new Response('Unauthorized', { status: 401 });
  try {
    const service = admin();
    const { data, error } = await service.rpc('claim_attachment_cleanup', { p_limit: 20 });
    if (error) throw error;
    let cleaned = 0,
      failed = 0;
    const removed = data?.length
      ? await service.storage
          .from('order-files')
          .remove(data.map((attachment: { path: string }) => attachment.path))
      : { error: null };
    for (const attachment of data || []) {
      const finished = await service.rpc('finish_attachment_cleanup', {
        p_id: attachment.id,
        p_lease: attachment.cleanup_id,
        p_success: !removed.error,
      });
      if (finished.error || !finished.data) throw new Error('Could not finalize file cleanup.');
      if (removed.error) failed++;
      else cleaned++;
    }
    return Response.json({ cleaned, failed }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json(
      { status: 'cleanup-unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
