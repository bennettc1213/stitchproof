import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Download,
  FileImage,
  LockKeyhole,
  Package,
  Printer,
  TriangleAlert,
} from 'lucide-react';
import type { Order, AssignmentMember } from '@/lib/domain';
import { dateOnly, totals } from '@/lib/domain';
import { Section, Status, ProofArt } from './ui';
import { ActionForm, Field, Textarea, IntakeForm, ReadyForm } from './forms';
import { OrderPanels } from './order-panels';
import { OrderControls } from './order-controls';
export type Attachment = {
  id: string;
  name: string;
  mime: string;
  purpose: string;
  caption: string;
  bytes: number;
};
export function OrderDetail({
  order: o,
  demo = false,
  files = [],
  timezone = 'America/Los_Angeles',
  members = [],
  readOnly = false,
  backHref,
}: {
  order: Order;
  demo?: boolean;
  files?: Attachment[];
  timezone?: string;
  members?: AssignmentMember[];
  readOnly?: boolean;
  backHref?: string;
}) {
  const base = demo ? '/demo' : '/app';
  const t = totals(o.garments);
  const locked = !['draft', 'open'].includes(o.lifecycle);
  const latest = o.proofs.at(-1);
  const steps = ['Intake', 'Approval', 'Production', 'Pickup'];
  const current =
    o.lifecycle === 'completed'
      ? 4
      : o.lifecycle === 'ready_for_pickup'
        ? 3
        : o.lifecycle === 'in_production'
          ? 2
          : o.approval === 'not_requested'
            ? 0
            : 1;
  return (
    <>
      <Link className="back-link" href={backHref || (demo ? base : base + '/orders')}>
        <ArrowLeft size={14} />
        All orders
      </Link>
      <div className="page-heading detail-heading">
        <div>
          <span className="eyebrow">
            ORDER #{o.number} <span className="dot-separator">·</span>{' '}
            {o.customers.company || o.customers.name}
          </span>
          <h1>{o.title}</h1>
          <p>
            {o.customers.name} <span className="dot-separator">·</span> Due {dateOnly(o.due_date)}
          </p>
        </div>
        <div className="heading-actions">
          <Status value={o.lifecycle} />
          {o.archived_at && <span className="tag">Archived</span>}
          {!demo && (
            <Link href={`/api/orders/${o.id}/pdf`} className="button secondary" target="_blank">
              <Printer size={16} />
              Order sheet
            </Link>
          )}
        </div>
      </div>
      {o.lifecycle === 'cancelled' && (
        <div className="notice warning">
          <strong>Order cancelled.</strong> {o.cancellation_reason} Pending review links are
          inactive. Files and history remain available.
        </div>
      )}
      {o.archived_at && (
        <div className="notice">This order is archived. Its status and records are preserved.</div>
      )}
      {o.lifecycle !== 'cancelled' && (
        <div className="workflow-steps">
          {steps.map((step, i) => (
            <div key={step} className={i < current ? 'done' : i === current ? 'current' : ''}>
              <span>{i < current ? <Check size={14} /> : i + 1}</span>
              <strong>{step}</strong>
              {i < steps.length - 1 && <div className="step-line" />}
            </div>
          ))}
        </div>
      )}
      <div className="detail-grid">
        <OrderPanels key={o.id}>
          <Section title="Garment intake" kicker="01 / THE DETAILS">
            <div className="intake-overview">
              <div>
                <strong>{t.expected}</strong>
                <span>Expected</span>
              </div>
              <div>
                <strong>{t.received}</strong>
                <span>Received</span>
              </div>
              <div>
                <strong className={t.expected !== t.received ? 'danger-text' : ''}>
                  {Math.abs(t.expected - t.received)}
                </strong>
                <span>{t.received > t.expected ? 'Extra' : 'Missing'}</span>
              </div>
              <span className="intake-icon">
                <Package size={28} />
              </span>
            </div>
            {t.expected !== t.received && (
              <div className="notice warning">
                <TriangleAlert size={17} />
                <span>
                  {t.expected - t.received} garment missing. Reconcile the size counts before
                  sending a proof.
                </span>
              </div>
            )}
            {o.garments.map((g, i) => (
              <div key={i} className="garment-block">
                <div className="garment-heading">
                  <div>
                    <h3>{g.description}</h3>
                    <p>{g.color || 'No color specified'} · Customer supplied</p>
                  </div>
                  <span className="tag">{totals([g]).expected} items</span>
                </div>
                <table className="intake-table">
                  <thead>
                    <tr>
                      <th>Size</th>
                      <th>Expected</th>
                      <th>Received</th>
                      <th>Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.sizes.map((s) => (
                      <tr key={s.size}>
                        <td>{s.size}</td>
                        <td>{s.expected}</td>
                        <td>{s.received}</td>
                        <td className={s.expected !== s.received ? 'danger-text' : ''}>
                          {s.received - s.expected || <Check size={14} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {locked ? (
              <p className="lock-note">
                <LockKeyhole size={14} />
                The approved production specification is locked.
              </p>
            ) : !demo ? (
              <details className="edit-disclosure">
                <summary>
                  {o.garments.length ? 'Edit intake & instructions' : 'Add garments & instructions'}
                </summary>
                <IntakeForm key={`${o.id}:${o.revision}`} order={o} />
              </details>
            ) : (
              <p className="fine-print">
                In your own shop, every count correction records a reason and preserves the previous
                values.
              </p>
            )}
          </Section>
          <Section title="Decoration instructions" kicker="02 / THE WORK">
            <dl className="spec-grid">
              {Object.entries({
                Placement: o.spec.placement,
                Design: o.spec.design,
                Dimensions: o.spec.dimensions,
                'Thread / colors': o.spec.thread,
                'Exact text': o.spec.text,
                Instructions: o.spec.instructions,
              }).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v || 'Not specified'}</dd>
                </div>
              ))}
            </dl>
          </Section>
          <Section
            title="Proofs & approval"
            kicker="03 / THE GO-AHEAD"
            action={<Status value={o.approval} />}
          >
            {latest ? (
              <>
                <div className="proof-version-header">
                  <div>
                    <strong>Version {latest.version}</strong>
                    <span>
                      {' '}
                      {latest.choice === 'changes_requested'
                        ? 'Customer requested a revision'
                        : latest.choice === 'approved'
                          ? 'Approved snapshot'
                          : 'Sent for customer review'}
                    </span>
                  </div>
                  {demo && (
                    <Link className="text-link" href="/demo/review">
                      Customer view
                      <ArrowUpRight size={14} />
                    </Link>
                  )}
                </div>
                {demo ? (
                  <ProofArt version={latest.version} />
                ) : (
                  <div className="file-list">
                    {latest.files.map((f) => (
                      <Link key={f.id} href={'/api/files/' + f.id} target="_blank">
                        <FileImage size={18} />
                        <span>{f.name}</span>
                        <ArrowUpRight size={14} />
                      </Link>
                    ))}
                  </div>
                )}
                {latest.comments && (
                  <blockquote className="change-comment">
                    “{latest.comments}”<cite>Customer · Version {latest.version}</cite>
                  </blockquote>
                )}
                {latest.choice === 'approved' && (
                  <div className="notice success">
                    <Check size={17} />
                    Approved by {latest.name}. The decision stays attached to this exact version.
                  </div>
                )}
                <div className="version-history">
                  {o.proofs.map((p) => (
                    <div key={p.id}>
                      <span>Version {p.version}</span>
                      <Status value={p.choice || 'pending'} />
                      {!demo && (
                        <Link
                          href={`/api/orders/${o.id}/pdf?proof=${p.id}`}
                          className="text-link"
                          target="_blank"
                        >
                          Record PDF
                          <Download size={12} />
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="proof-empty">
                <FileImage size={26} />
                <h3>A clear proof comes next.</h3>
                <p>Confirm your intake, upload the artwork, and create a customer review link.</p>
              </div>
            )}
            {!demo && !locked && (
              <>
                <details className="edit-disclosure">
                  <summary>Upload a proof file</summary>
                  <ActionForm intent="upload" label="Upload proof">
                    <input type="hidden" name="order" value={o.id} />
                    <input type="hidden" name="purpose" value="proof" />
                    <label className="field">
                      <span>Artwork file</span>
                      <input
                        type="file"
                        name="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        required
                      />
                      <small>JPEG, PNG, WebP or PDF · 10 MiB per file</small>
                    </label>
                  </ActionForm>
                </details>
                {files.some((f) => f.purpose === 'proof') && (
                  <details className="edit-disclosure">
                    <summary>Create a new review request</summary>
                    <p className="muted">
                      A new numbered snapshot preserves the current counts, instructions, and
                      policy. Earlier pending links are revoked.
                    </p>
                    <ActionForm intent="send-proof" label="Create customer review link">
                      <input type="hidden" name="order" value={o.id} />
                      <input type="hidden" name="revision" value={o.revision} />
                      <label className="check-field">
                        <input type="checkbox" name="queue_email" />
                        Also queue an email to {o.customers.email}. Delivery depends on the shop’s
                        email configuration.
                      </label>
                      {files
                        .filter((f) => f.purpose === 'proof')
                        .map((f) => (
                          <label className="check-field" key={f.id}>
                            <input type="checkbox" name="files" value={f.id} />
                            {f.name}
                          </label>
                        ))}
                    </ActionForm>
                  </details>
                )}
                {o.approval === 'pending' && (
                  <ActionForm intent="revoke" label="Revoke outstanding review link">
                    <input type="hidden" name="order" value={o.id} />
                  </ActionForm>
                )}
              </>
            )}
          </Section>
          <Section title="Production & pickup" kicker="04 / THE FINISH">
            {demo ? (
              <>
                <p className="muted">
                  Production starts against the exact approved snapshot. Completed garments and
                  exceptions must reconcile before pickup.
                </p>
                <Link className="text-link" href="/demo/story">
                  Explore the complete journey
                  <ArrowUpRight size={14} />
                </Link>
              </>
            ) : o.lifecycle === 'open' ? (
              <>
                <p className="muted">
                  Start only when the current proof is approved and every garment is accounted for.
                </p>
                <ActionForm intent="start-production" label="Start production">
                  <input name="order" type="hidden" value={o.id} />
                </ActionForm>
              </>
            ) : o.lifecycle === 'in_production' ? (
              <ReadyForm order={o} />
            ) : o.lifecycle === 'ready_for_pickup' ? (
              <>
                <ActionForm intent="pickup-email" label="Queue pickup notice">
                  <input name="order" type="hidden" value={o.id} />
                  <p className="muted">
                    Notify {o.customers.email}. Repeated clicks reuse the same notice.
                  </p>
                </ActionForm>
                <ActionForm intent="collect" label="Record collection">
                  <input name="order" type="hidden" value={o.id} />
                  <Field name="collector" label="Collector’s full name" required />
                  <label className="check-field">
                    <input type="checkbox" name="confirm" required />I confirm the entire order has
                    been collected.
                  </label>
                </ActionForm>
              </>
            ) : o.lifecycle === 'cancelled' ? (
              <p className="muted">
                This order was cancelled before production. Its history and any recorded decisions
                are preserved.
              </p>
            ) : o.lifecycle === 'completed' ? (
              <div className="notice success">
                <Check size={17} />
                This order has been collected. Its history and approval record remain available.
              </div>
            ) : (
              <p className="muted">Finish intake and obtain approval to start production.</p>
            )}
          </Section>
        </OrderPanels>
        <aside className="detail-secondary">
          {!demo && (
            <Section title="Order controls">
              <OrderControls order={o} members={members} readOnly={readOnly} />
            </Section>
          )}
          <Section title="Customer">
            <span className="customer-large">{o.customers.name}</span>
            <p>{o.customers.company}</p>
            <a href={'mailto:' + o.customers.email} className="text-link">
              {o.customers.email}
              <ArrowUpRight size={13} />
            </a>
            <div className="mini-divider" />
            <Link className="text-link" href={base + '/customers/' + o.customer_id}>
              View customer record
              <ArrowUpRight size={13} />
            </Link>
          </Section>
          <Section title="Condition photos">
            {files
              .filter((f) => f.purpose === 'condition')
              .map((f) => (
                <div key={f.id} className="condition-file">
                  <Link href={'/api/files/' + f.id} target="_blank">
                    <FileImage size={18} />
                    {f.name}
                  </Link>
                  <p>{f.caption}</p>
                  <small>Upload time does not establish when a photo was taken.</small>
                </div>
              ))}
            {!files.some((f) => f.purpose === 'condition') && (
              <p className="muted">
                Document stains, holes, or existing embroidery before work begins.
              </p>
            )}
            {!demo && !locked && (
              <ActionForm intent="upload" label="Add condition photo">
                <input type="hidden" name="order" value={o.id} />
                <input type="hidden" name="purpose" value="condition" />
                <label className="field">
                  <span>Photo</span>
                  <input
                    type="file"
                    name="file"
                    accept="image/jpeg,image/png,image/webp"
                    required
                  />
                </label>
                <Field name="caption" label="Condition note" />
              </ActionForm>
            )}
          </Section>
          <Section title="Order history">
            <div className="timeline">
              {o.events.map((e) => (
                <div className="timeline-event" key={e.id}>
                  <span className="timeline-dot" />
                  <strong>{e.kind}</strong>
                  <time>
                    {new Intl.DateTimeFormat('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                      timeZone: timezone,
                    }).format(new Date(e.created_at))}
                  </time>
                  {['reason', 'comments', 'collector'].map((k) =>
                    e.details[k] ? <p key={k}>{String(e.details[k])}</p> : null,
                  )}
                  {e.kind === 'Assignment changed' && (
                    <p>
                      {String(e.details.previous_label || 'Unassigned')} →{' '}
                      {String(e.details.assigned_label || 'Unassigned')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Section>
          <Section title="Internal notes" action={<LockKeyhole size={14} />}>
            {demo ? (
              <p className="muted">{o.internal_notes}</p>
            ) : (
              <ActionForm intent="note" label="Save internal note">
                <input type="hidden" name="order" value={o.id} />
                <input type="hidden" name="revision" value={o.revision} />
                <Textarea
                  name="note"
                  label="Visible only to your team"
                  defaultValue={o.internal_notes}
                />
              </ActionForm>
            )}
          </Section>
        </aside>
      </div>
    </>
  );
}
