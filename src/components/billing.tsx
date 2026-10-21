import type { BillingSummary } from '@/lib/billing-domain';
import { ActionForm } from './forms';

export function Billing({
  summary,
  mode,
}: {
  summary: BillingSummary;
  mode: 'test' | 'live' | 'unconfigured';
}) {
  const date = (value: string | null) =>
    value ? new Date(value).toISOString().slice(0, 10) + ' UTC' : 'Not set';
  return (
    <>
      <dl className="spec-grid">
        <div>
          <dt>Subscription</dt>
          <dd>{summary.status.replaceAll('_', ' ')}</dd>
        </div>
        <div>
          <dt>App trial ends</dt>
          <dd>{date(summary.trial_ends_at)}</dd>
        </div>
        <div>
          <dt>Paid through</dt>
          <dd>{date(summary.paid_through)}</dd>
        </div>
        <div>
          <dt>Payment grace ends</dt>
          <dd>{date(summary.grace_until)}</dd>
        </div>
      </dl>
      {summary.cancel_at_period_end && (
        <p className="notice">Cancellation is scheduled at the end of the paid period.</p>
      )}
      {mode === 'unconfigured' ? (
        <p className="notice warning">
          Billing is not configured. No payment is collected here. The seven-day app trial still
          applies.
        </p>
      ) : (
        <>
          {mode === 'test' && (
            <p className="notice warning">
              Stripe test mode. Use test payment details only; no real payment is collected.
            </p>
          )}
          {!summary.has_customer ||
          ['not_subscribed', 'canceled', 'incomplete_expired'].includes(summary.status) ? (
            <ActionForm intent="billing-checkout" label="Subscribe for $39 USD/month">
              <label className="check-field">
                <input type="checkbox" name="confirm" required />I understand the paid subscription
                starts immediately at checkout. The unused app trial does not delay payment.
              </label>
            </ActionForm>
          ) : null}
          {summary.has_customer && (
            <ActionForm intent="billing-portal" label="Manage billing & invoices">
              <p>Update payment details or cancel at the end of your paid period.</p>
            </ActionForm>
          )}
          <ActionForm intent="billing-refresh" label="Refresh billing status">
            <p className="fine-print">
              Checkout redirects do not grant access. Status is confirmed with Stripe on the server.
            </p>
          </ActionForm>
        </>
      )}
    </>
  );
}
