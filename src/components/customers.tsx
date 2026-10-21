import Link from 'next/link';
import type { Order } from '@/lib/domain';
import { Avatar, Empty, Section, Status } from './ui';
import { ArrowLeft, ArrowUpRight, Mail, Search } from 'lucide-react';
import type { Customer, CustomerDirectory, CustomerHistory } from '@/lib/customers';
import { ActionForm, Field, Textarea } from './forms';
import { Pagination } from './pagination';
export function Customers({
  customers,
  orders = [],
  directory,
  history,
  readOnly = false,
  demo = false,
  id,
}: {
  customers: Customer[];
  orders?: Order[];
  directory?: CustomerDirectory;
  history?: CustomerHistory;
  readOnly?: boolean;
  demo?: boolean;
  id?: string;
}) {
  const base = demo ? '/demo' : '/app';
  const shown = id ? customers.filter((c) => c.id === id) : customers;
  const customer = shown[0];
  return (
    <>
      {id && (
        <Link href={base + '/customers'} className="back-link">
          <ArrowLeft size={14} /> All customers
        </Link>
      )}
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE PEOPLE BEHIND THE ORDERS</span>
          <h1>{id ? shown[0]?.name || 'Customer not found' : 'Customers'}</h1>
          <p>Keep the relationship and the work in the same place.</p>
        </div>
      </div>
      {!id && (
        <form
          action={base + '/customers'}
          className="customer-search"
          role="search"
          key={directory?.query || ''}
        >
          <label className="search-field">
            <Search size={17} aria-hidden="true" />
            <input
              name="q"
              aria-label="Search customers"
              placeholder="Name, company, email, or phone…"
              maxLength={160}
              defaultValue={directory?.query || ''}
            />
          </label>
          <button className="button primary" type="submit">
            Search
          </button>
          {directory?.query && (
            <Link href={base + '/customers'} className="text-link">
              Clear search
            </Link>
          )}
        </form>
      )}
      {!shown.length ? (
        <Empty title={directory?.query ? 'No matching customers' : 'No customers yet'}>
          {directory?.query
            ? 'Try a different name, company, email, or phone.'
            : 'Customers are added when you create their first order.'}
        </Empty>
      ) : (
        <div className={id ? 'customer-profile' : 'customer-grid'}>
          {shown.map((c) => (
            <section className="panel customer-card" key={c.id}>
              <div className="customer-card-top">
                <Avatar name={c.company || c.name} />
                <Link
                  className="row-arrow"
                  href={base + '/customers/' + c.id}
                  aria-label={'View ' + c.name}
                >
                  <ArrowUpRight size={18} />
                </Link>
              </div>
              <h2>{c.company || c.name}</h2>
              <p>{c.name}</p>
              <a href={'mailto:' + c.email} className="text-link">
                <Mail size={14} />
                {c.email}
              </a>
              <div className="mini-divider" />
              {!id && !demo && (
                <Link className="text-link" href={base + '/customers/' + c.id}>
                  View {c.order_count || 0} {(c.order_count || 0) === 1 ? 'order' : 'orders'}{' '}
                  <ArrowUpRight size={14} />
                </Link>
              )}
              {demo && <span className="eyebrow">ORDER HISTORY</span>}
              {demo &&
                orders
                  .filter((o) => o.customer_id === c.id)
                  .map((o) => (
                    <Link key={o.id} href={base + '/orders/' + o.id} className="customer-order">
                      <span>
                        <small>#{o.number}</small>
                        {o.title}
                      </span>
                      <ArrowUpRight size={14} />
                    </Link>
                  ))}
              {c.phone && <p>{c.phone}</p>}
              {id && c.internal_notes && (
                <p className="notice">Internal notes: {c.internal_notes}</p>
              )}
            </section>
          ))}
        </div>
      )}
      {!id && directory && (
        <Pagination
          info={directory}
          path={base + '/customers'}
          query={directory.query}
          label="Customer pages"
        />
      )}
      {id && customer && !demo && (
        <div className="customer-detail-grid">
          <Section title="Contact details" kicker="CUSTOMER RECORD">
            <p className="muted">
              Updates apply to this customer’s orders and future messages. Sent proofs, recorded
              approvals, and emails already queued keep their original records.
            </p>
            {readOnly ? (
              <p className="notice">
                Your shop is read-only. Customer details and order history remain available.
              </p>
            ) : (
              <ActionForm
                key={customer.id}
                intent="update-customer"
                label="Save customer"
                expectedRevision={customer.revision}
              >
                <input type="hidden" name="customer" value={customer.id} />
                <Field
                  name="name"
                  label="Customer name"
                  required
                  maxLength={160}
                  defaultValue={customer.name}
                />
                <Field
                  name="company"
                  label="Company (optional)"
                  maxLength={160}
                  defaultValue={customer.company}
                />
                <Field
                  name="email"
                  label="Customer email"
                  type="email"
                  required
                  maxLength={254}
                  defaultValue={customer.email}
                />
                <Field
                  name="phone"
                  label="Phone (optional)"
                  type="tel"
                  maxLength={80}
                  defaultValue={customer.phone}
                />
                <Textarea
                  name="notes"
                  label="Internal customer notes"
                  defaultValue={customer.internal_notes}
                  help="Visible only to your shop. Maximum 10,000 characters."
                  maxLength={10000}
                />
              </ActionForm>
            )}
          </Section>
          <Section title="Order history" kicker={`${history?.total || 0} ORDERS`}>
            {!history?.orders.length ? (
              <p>No orders for this customer yet.</p>
            ) : (
              history.orders.map((o) => (
                <Link key={o.id} href={base + '/orders/' + o.id} className="customer-order">
                  <span>
                    <small>#{o.number}</small>
                    {o.title}
                  </span>
                  <Status value={o.lifecycle} />
                </Link>
              ))
            )}
            {history && (
              <Pagination
                info={history}
                path={base + '/customers/' + id}
                label="Customer order pages"
              />
            )}
          </Section>
        </div>
      )}
    </>
  );
}
