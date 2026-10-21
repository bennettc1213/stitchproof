import { supabase } from '@/lib/supabase/server';
export async function GET() {
  try {
    const db = await supabase();
    const { data: auth } = await db.auth.getClaims();
    if (!auth?.claims) return new Response('Unauthorized', { status: 401 });
    const { data: membership } = await db
      .from('memberships')
      .select('role,workspace_id')
      .eq('user_id', auth.claims.sub)
      .single();
    if (membership?.role !== 'owner') return new Response('Owner access required', { status: 403 });
    const tables = [
      'customers',
      'orders',
      'proof_versions',
      'approval_decisions',
      'production_runs',
      'collections',
      'order_events',
      'attachments',
    ];
    const exported: Record<string, unknown> = {
      format_version: 1,
      exported_at: new Date().toISOString(),
      attachment_note:
        'Binary files are not included in JSON. Download the authenticated paths in attachment_downloads while signed in to this shop.',
    };
    // Keyset pagination avoids Supabase's row cap silently truncating an owner export.
    for (const table of tables) {
      const data: Record<string, unknown>[] = [];
      let offset = 0;
      for (;;) {
        const key = table === 'production_runs' || table === 'collections' ? 'order_id' : 'id';
        const result = await db
          .from(table)
          .select('*')
          .eq('workspace_id', membership.workspace_id)
          .order(key)
          .range(offset, offset + 499);
        if (result.error) throw result.error;
        data.push(...(result.data || []));
        if ((result.data || []).length < 500) break;
        offset += 500;
      }
      exported[table] = data;
    }
    exported.attachment_downloads = (
      exported.attachments as {
        id: string;
        name: string;
        state: string;
        digest: string;
      }[]
    )
      .filter((f) => f.state === 'ready')
      .map((f) => ({
        id: f.id,
        name: f.name,
        digest: f.digest,
        authenticated_download: '/api/files/' + f.id,
      }));
    const { data: shop } = await db
      .from('workspaces')
      .select('logo_digest,logo_width,logo_height,logo_updated_at')
      .eq('id', membership.workspace_id)
      .single();
    exported.shop_logo = shop?.logo_digest
      ? {
          digest: shop.logo_digest,
          width: shop.logo_width,
          height: shop.logo_height,
          updated_at: shop.logo_updated_at,
          authenticated_download: '/api/logo',
        }
      : null;
    return Response.json(exported, {
      headers: {
        'Content-Disposition': 'attachment; filename="stitchproof-workspace.json"',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return new Response('Export unavailable. Please retry.', { status: 503 });
  }
}
