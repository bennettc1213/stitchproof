import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { ActionForm, Field } from './forms';
import { Section } from './ui';
export function NewOrder({ demo = false }: { demo?: boolean }) {
  return (
    <>
      <Link className="back-link" href={demo ? '/demo' : '/app/orders'}>
        ← All orders
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">START WITH THE ESSENTIALS</span>
          <h1>A new order.</h1>
          <p>Who it’s for, what it is, and when it’s needed. Garments come next.</p>
        </div>
      </div>
      <div className="new-order-layout">
        <Section title="Order details">
          {demo ? (
            <>
              <div className="notice">
                This is a read-only product tour. New records require your own authenticated shop.
              </div>
              <div className="form">
                <Field name="title" label="Job title" defaultValue="Northline team polos" />
                <div className="form-row">
                  <Field name="customer_name" label="Customer name" defaultValue="Alex Morgan" />
                  <Field name="company" label="Company" defaultValue="Northline Studio" />
                </div>
                <Field name="email" label="Customer email" defaultValue="northline@example.test" />
                <Field name="due_date" label="Due date" type="date" defaultValue="2026-10-23" />
                <Link className="button primary fit" href="/signup">
                  Start your own shop →
                </Link>
              </div>
            </>
          ) : (
            <ActionForm intent="create-order" label="Create order & add garments">
              <input type="hidden" name="key" value={randomUUID()} />
              <Field
                name="title"
                label="Job title"
                placeholder="e.g. Northline team polos"
                required
                maxLength={160}
              />
              <div className="form-row">
                <Field name="customer_name" label="Customer name" required maxLength={160} />
                <Field name="company" label="Company (optional)" maxLength={160} />
              </div>
              <Field
                name="email"
                label="Customer email"
                type="email"
                required
                help="An existing matching email reuses that customer record without changing its details."
              />
              <Field name="due_date" label="Due date" type="date" />
            </ActionForm>
          )}
        </Section>
        <aside className="new-order-note">
          <span className="tiny-stitch">✳</span>
          <h3>From here, it stays together.</h3>
          <p>
            Add garment counts, condition photos, and decoration instructions. Once everything
            reconciles, send the exact proof for approval.
          </p>
          <ol>
            <li>Record the intake</li>
            <li>Get the right approval</li>
            <li>Produce & hand it over</li>
          </ol>
        </aside>
      </div>
    </>
  );
}
