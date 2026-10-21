import { supabase } from '@/lib/supabase/server';
import { order, context } from '@/lib/data';
import { orderPdf } from '@/lib/pdf';
import { appOrigin } from '@/lib/config';
import { logoBytes } from '@/lib/shop-logo';
import { proofFileLoader } from '@/lib/proof-files';
import { ProofArtworkError } from '@/lib/proof-artwork';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = await supabase();
  const { data: auth } = await db.auth.getClaims();
  if (!auth?.claims) return new Response('Unauthorized', { status: 401 });
  const { id } = await params;
  // Check this exact order through RLS before calling page-oriented helpers,
  // which redirect accounts without membership to onboarding.
  const { data: visible } = await db.from('orders').select('id').eq('id', id).maybeSingle();
  if (!visible) return new Response('Not found', { status: 404 });
  const result = await order(id);
  if (!result) return new Response('Not found', { status: 404 });
  const { shop } = await context();
  const proofId = new URL(request.url).searchParams.get('proof');
  const proof = proofId ? result.order.proofs.find((p) => p.id === proofId) : undefined;
  if (proofId && !proof) return new Response('Not found', { status: 404 });
  let bytes;
  try {
    bytes = await orderPdf(
      result.order,
      shop.name,
      appOrigin() + '/app/orders/' + id,
      proof,
      await logoBytes(shop.logo_path),
      proof ? proofFileLoader(db, id) : undefined,
    );
  } catch (error) {
    if (!(error instanceof ProofArtworkError)) throw error;
    return new Response(error.message, {
      status: 422,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="order-${result.order.number}${proof ? '-proof-v' + proof.version : ''}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
