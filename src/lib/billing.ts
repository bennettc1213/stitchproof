import 'server-only';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { admin } from './supabase/admin';
import { context } from './data';
import { appOrigin } from './config';
import { assertShopPrice, billingConfiguration, billingSnapshot } from './billing-domain';

function provider() {
  const config = billingConfiguration();
  if (!config)
    throw new Error(
      'Billing is not configured. The order workflow remains available during your app trial.',
    );
  return {
    config,
    stripe: new Stripe(config.key, {
      apiVersion: '2026-09-30.endive',
      timeout: 8000,
      maxNetworkRetries: 1,
    }),
  };
}
async function checked<T>(request: PromiseLike<{ data: T; error: { message: string } | null }>) {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data;
}
export async function reconcileBilling(customer: string, eventId: string, event?: Stripe.Event) {
  const { config, stripe } = provider();
  const service = admin();
  // Stripe sends several events for one checkout within a second. Wait briefly for a concurrent
  // reconciliation instead of failing; a 503 would delay entitlement until Stripe's next retry.
  let lease;
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await service.rpc('claim_billing_sync', {
      p_customer: customer,
      p_event: eventId,
    });
    if (!error) {
      lease = data;
      break;
    }
    if (attempt >= 15 || !error.message.includes('already running')) throw new Error(error.message);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (lease.untracked || lease.duplicate) return;
  try {
    const subscriptions = await stripe.subscriptions.list({
      customer,
      status: 'all',
      limit: 100,
      expand: ['data.latest_invoice'],
    });
    if (subscriptions.has_more) throw new Error('Billing needs an operator reconciliation.');
    const owned = subscriptions.data.filter((s) => s.metadata.workspace_id === lease.workspace);
    const current = owned.filter((s) => !['canceled', 'incomplete_expired'].includes(s.status));
    if (current.length > 1) throw new Error('Multiple subscriptions need operator reconciliation.');
    const subscription = current[0] || owned.sort((a, b) => b.created - a.created)[0] || null;
    if (subscription && typeof subscription.latest_invoice === 'string')
      subscription.latest_invoice = await stripe.invoices.retrieve(subscription.latest_invoice);
    const snapshot = billingSnapshot(
      subscription,
      lease.workspace,
      config.price,
      config.live,
      event,
    );
    await checked(
      service.rpc('apply_billing_snapshot', {
        p_customer: customer,
        p_event: eventId,
        p_lease: lease.lease,
        p_subscription: snapshot.subscription,
        p_status: snapshot.status,
        p_paid: snapshot.paid,
        p_failure: snapshot.failure,
        p_cancel: snapshot.cancel,
        p_ended: snapshot.ended,
      }),
    );
  } catch (error) {
    await service.rpc('release_billing_sync', { p_customer: customer, p_lease: lease.lease });
    throw error;
  }
}

function hostedUrl(value: string | null, hostname: string) {
  if (!value) throw new Error('The billing provider did not return a hosted page.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== hostname)
    throw new Error('Unexpected billing provider address.');
  return value;
}

export async function checkout() {
  const { config, stripe } = provider();
  const { db, shop, member, user } = await context();
  if (member.role !== 'owner') throw new Error('Owner access required.');
  const reservation = await checked(db.rpc('begin_checkout'));
  const service = admin();
  let completed = false;
  try {
    let customer: string = reservation.customer;
    if (!customer) {
      const created = await stripe.customers.create(
        { name: shop.name, email: String(user.email || ''), metadata: { workspace_id: shop.id } },
        { idempotencyKey: 'threadproof-customer/' + shop.id },
      );
      customer = created.id;
      await checked(
        service.rpc('bind_billing_customer', {
          p_workspace: shop.id,
          p_lease: reservation.lease,
          p_customer: customer,
        }),
      );
    }
    const subscriptions = await stripe.subscriptions.list({ customer, status: 'all', limit: 100 });
    if (
      subscriptions.has_more ||
      subscriptions.data.some((s) => !['canceled', 'incomplete_expired'].includes(s.status))
    ) {
      await reconcileBilling(customer, 'refresh/' + randomUUID());
      throw new Error(
        'This shop already has a subscription or payment in progress. Use Manage billing.',
      );
    }
    if (reservation.checkout) {
      const existing = await stripe.checkout.sessions.retrieve(reservation.checkout);
      if (existing.status === 'open') {
        const result = hostedUrl(existing.url, 'checkout.stripe.com');
        await checked(
          service.rpc('finish_checkout', {
            p_workspace: shop.id,
            p_lease: reservation.lease,
            p_checkout: existing.id,
          }),
        );
        completed = true;
        return result;
      }
      // Completed or manually expired sessions must never silently start another checkout.
      throw new Error(
        'The previous checkout is no longer open. Refresh billing, or retry after its reserved session expires.',
      );
    }
    // Recover a created session even if its earlier database finalization failed.
    const openSessions = await stripe.checkout.sessions.list({
      customer,
      status: 'open',
      limit: 100,
    });
    if (openSessions.has_more) throw new Error('Billing needs an operator reconciliation.');
    const ownedSessions = openSessions.data.filter(
      (session) => session.metadata?.workspace_id === shop.id,
    );
    if (ownedSessions.length > 1)
      throw new Error('Multiple checkout sessions need operator reconciliation.');
    if (ownedSessions[0]) {
      const recovered = ownedSessions[0];
      const result = hostedUrl(recovered.url, 'checkout.stripe.com');
      await checked(
        service.rpc('finish_checkout', {
          p_workspace: shop.id,
          p_lease: reservation.lease,
          p_checkout: recovered.id,
        }),
      );
      completed = true;
      return result;
    }
    if (new Date(reservation.expires_at).getTime() - Date.now() < 30 * 60000) {
      throw new Error(
        'The previous billing attempt could not finish. Retry after the reserved checkout expires, within one hour of the initial attempt.',
      );
    }
    const price = await stripe.prices.retrieve(config.price);
    assertShopPrice(price, config.live);
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer,
        client_reference_id: shop.id,
        line_items: [{ price: config.price, quantity: 1 }],
        allowed_payment_method_types: ['card'],
        allow_promotion_codes: false,
        // Founder decision (October 21, 2026): Stripe is not merchant of record for now.
        managed_payments: { enabled: false },
        subscription_data: { metadata: { workspace_id: shop.id } },
        metadata: { workspace_id: shop.id },
        expires_at: Math.floor(new Date(reservation.expires_at).getTime() / 1000),
        success_url: appOrigin() + '/app/settings/billing?checkout=returned',
        cancel_url: appOrigin() + '/app/settings/billing',
      },
      { idempotencyKey: `threadproof-checkout/${shop.id}/${reservation.generation}` },
    );
    const result = hostedUrl(session.url, 'checkout.stripe.com');
    await checked(
      service.rpc('finish_checkout', {
        p_workspace: shop.id,
        p_lease: reservation.lease,
        p_checkout: session.id,
      }),
    );
    completed = true;
    return result;
  } finally {
    if (!completed)
      await service.rpc('finish_checkout', {
        p_workspace: shop.id,
        p_lease: reservation.lease,
        p_checkout: null,
      });
  }
}

export async function billingPortal() {
  const { config, stripe } = provider();
  const { db, member } = await context();
  if (member.role !== 'owner') throw new Error('Owner access required.');
  const customer = await checked(db.rpc('billing_customer'));
  if (!customer) throw new Error('Subscribe first to manage billing.');
  const configuration = await stripe.billingPortal.configurations.retrieve(config.portal);
  if (
    configuration.livemode !== config.live ||
    !configuration.active ||
    !configuration.features.subscription_cancel.enabled ||
    configuration.features.subscription_cancel.mode !== 'at_period_end' ||
    configuration.features.subscription_update.enabled
  ) {
    throw new Error(
      'Configure a billing portal with cancellation at period end and no plan switching.',
    );
  }
  const session = await stripe.billingPortal.sessions.create({
    customer,
    configuration: config.portal,
    return_url: appOrigin() + '/app/settings/billing',
  });
  return hostedUrl(session.url, 'billing.stripe.com');
}

export async function refreshBilling() {
  const { db, member } = await context();
  if (member.role !== 'owner') throw new Error('Owner access required.');
  const customer = await checked(db.rpc('billing_customer'));
  if (customer) await reconcileBilling(customer, 'refresh/' + randomUUID());
}
