import { supabase } from '@/lib/supabase/server';
import { reviewAccess } from '@/lib/review-access';
import { logoBytes } from '@/lib/shop-logo';
const notFound = () =>
  new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get('token');
    let logo: { path: string; digest: string } | null = null;
    if (token) {
      // Only an active, unexpired review link reveals its own shop's current logo.
      if (!/^[a-f0-9]{64}$/.test(token)) return notFound();
      const { service, digest } = await reviewAccess(token);
      const { data } = await service.rpc('review_logo', { p_digest: digest });
      logo = data;
    } else {
      const db = await supabase();
      const { data: auth } = await db.auth.getClaims();
      if (!auth?.claims) return new Response('Unauthorized', { status: 401 });
      const { data: member } = await db
        .from('memberships')
        .select('workspace_id')
        .eq('user_id', auth.claims.sub)
        .single();
      if (!member) return notFound();
      const { data } = await db
        .from('workspaces')
        .select('logo_path,logo_digest')
        .eq('id', member.workspace_id)
        .single();
      if (data?.logo_path) logo = { path: data.logo_path, digest: data.logo_digest };
    }
    if (!logo?.path) return notFound();
    const etag = `"${logo.digest}"`;
    const headers = {
      'Cache-Control': 'private, no-cache',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    };
    if (request.headers.get('if-none-match') === etag)
      return new Response(null, { status: 304, headers });
    const bytes = await logoBytes(logo.path);
    if (!bytes) return notFound();
    return new Response(Buffer.from(bytes), {
      headers: {
        ...headers,
        'Content-Type': 'image/png',
        'Content-Disposition': 'inline; filename="shop-logo.png"',
      },
    });
  } catch {
    return notFound();
  }
}
