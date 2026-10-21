import { supabase } from '@/lib/supabase/server';
import { admin } from '@/lib/supabase/admin';
import { reviewAccess } from '@/lib/review-access';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    let file;
    if (token) {
      if (!/^[a-f0-9]{64}$/.test(token)) return new Response('Not found', { status: 404 });
      const { service, digest } = await reviewAccess(token);
      const { data: review } = await service.rpc('review_bundle', {
        p_digest: digest,
      });
      if (!review?.files?.some((f: { id: string }) => f.id === id))
        return new Response('Not found', { status: 404 });
      const { data } = await service
        .from('attachments')
        .select('path,mime,name')
        .eq('id', id)
        .eq('state', 'ready')
        .single();
      file = data;
    } else {
      const db = await supabase();
      const { data: auth } = await db.auth.getClaims();
      if (!auth?.claims) return new Response('Unauthorized', { status: 401 });
      const { data } = await db
        .from('attachments')
        .select('path,mime,name')
        .eq('id', id)
        .eq('state', 'ready')
        .single();
      file = data;
    }
    if (!file) return new Response('Not found', { status: 404 });
    const { data, error } = await admin().storage.from('order-files').download(file.path);
    if (error || !data) return new Response('Not found', { status: 404 });
    return new Response(data, {
      headers: {
        'Content-Type': file.mime,
        'Content-Disposition': `inline; filename="${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
