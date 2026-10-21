import { billingConfiguration, verifyBillingEvent } from '@/lib/billing-domain';
import { reconcileBilling } from '@/lib/billing';

export const runtime = 'nodejs';
const events = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
]);
export async function POST(request: Request) {
  const config = billingConfiguration();
  if (!config) return new Response('Billing not configured', { status: 503 });
  if (Number(request.headers.get('content-length') || '0') > 1048576)
    return new Response('Payload too large', { status: 413 });
  let event;
  try {
    const chunks: Uint8Array[] = [];
    const reader = request.body?.getReader();
    let bytes = 0;
    while (reader) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1048576) {
        await reader.cancel();
        return new Response('Payload too large', { status: 413 });
      }
      chunks.push(chunk.value);
    }
    const body = Buffer.concat(chunks);
    event = verifyBillingEvent(body, request.headers.get('stripe-signature') || '', config.webhook);
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }
  if (event.livemode !== config.live) return new Response('Wrong billing mode', { status: 400 });
  if (!events.has(event.type)) return Response.json({ received: true });
  const object = event.data.object;
  if (!('customer' in object)) return new Response('Invalid event', { status: 400 });
  const customer = typeof object.customer === 'string' ? object.customer : object.customer?.id;
  if (!customer) return new Response('Invalid event', { status: 400 });
  try {
    await reconcileBilling(customer, event.id, event);
    return Response.json({ received: true });
  } catch {
    // A non-2xx response lets Stripe retry; never acknowledge an uncommitted entitlement update.
    return new Response('Reconciliation unavailable', { status: 503 });
  }
}
