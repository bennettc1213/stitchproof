import Stripe from 'stripe';

export function billingConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const key = env.STRIPE_SECRET_KEY || '';
  const live = env.STRIPE_MODE === 'live';
  if (
    (live || key.startsWith('sk_live_')) &&
    !(live && env.NODE_ENV === 'production' && env.STRIPE_ALLOW_LIVE === 'true')
  ) {
    throw new Error('Live Stripe is disabled. Local development requires test keys.');
  }
  if (
    !key ||
    !env.STRIPE_WEBHOOK_SECRET ||
    !env.STRIPE_PRICE_ID ||
    !env.STRIPE_PORTAL_CONFIGURATION_ID
  )
    return null;
  if (!key.startsWith(live ? 'sk_live_' : 'sk_test_'))
    throw new Error('Stripe key does not match the configured mode.');
  return {
    key,
    live,
    webhook: env.STRIPE_WEBHOOK_SECRET,
    price: env.STRIPE_PRICE_ID,
    portal: env.STRIPE_PORTAL_CONFIGURATION_ID,
  };
}

export function assertShopPrice(price: Stripe.Price, live: boolean, active = true) {
  if (
    price.livemode !== live ||
    (active && !price.active) ||
    price.currency !== 'usd' ||
    price.unit_amount !== 3900 ||
    price.type !== 'recurring' ||
    price.recurring?.interval !== 'month' ||
    price.recurring.interval_count !== 1 ||
    price.recurring.usage_type !== 'licensed' ||
    price.recurring.trial_period_days ||
    price.transform_quantity
  ) {
    throw new Error('Configure the fixed $39 USD monthly shop price with no Stripe trial.');
  }
}

export function verifyBillingEvent(body: string | Buffer, signature: string, secret: string) {
  return Stripe.webhooks.constructEvent(body, signature, secret);
}

export function billingSnapshot(
  subscription: Stripe.Subscription | null,
  workspace: string,
  price: string,
  live: boolean,
  event?: Stripe.Event,
) {
  if (!subscription)
    return {
      subscription: null,
      status: 'not_subscribed',
      paid: null,
      failure: null,
      cancel: false,
      ended: new Date().toISOString(),
    };
  if (
    subscription.livemode !== live ||
    subscription.metadata.workspace_id !== workspace ||
    subscription.items.data.length !== 1
  )
    throw new Error('Subscription does not match this workspace.');
  const item = subscription.items.data[0];
  if (item.price.id !== price || item.quantity !== 1)
    throw new Error('Subscription does not match the shop plan.');
  assertShopPrice(item.price, live, false);
  const invoice =
    typeof subscription.latest_invoice === 'object' ? subscription.latest_invoice : null;
  const paid = subscription.status === 'active' && invoice?.status === 'paid';
  const delinquent = subscription.status === 'past_due' || subscription.status === 'unpaid';
  const failure =
    delinquent && invoice
      ? event?.type === 'invoice.payment_failed' && event.data.object.id === invoice.id
        ? event.created
        : invoice.status_transitions.finalized_at || invoice.created
      : null;
  const iso = (time: number | null | undefined) =>
    time ? new Date(time * 1000).toISOString() : null;
  return {
    subscription: subscription.id,
    status: subscription.status,
    paid: paid ? iso(item.current_period_end) : null,
    failure: iso(failure),
    cancel: subscription.cancel_at_period_end,
    ended: iso(subscription.ended_at),
  };
}

export type BillingSummary = {
  status: string;
  has_customer: boolean;
  cancel_at_period_end: boolean;
  checked_at: string | null;
  trial_ends_at: string;
  paid_through: string | null;
  grace_until: string | null;
};
