'use client';
import { useActionState, useId, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, Clipboard, LoaderCircle } from 'lucide-react';
import { perform, decide, type ActionState } from '@/app/actions';
import type { Garment, Order } from '@/lib/domain';
import { totals, DESIGN_CONFIRMATION, POLICY_CONFIRMATION } from '@/lib/domain';
export function Submit({
  children,
  className = 'button primary',
  name,
  value,
  formNoValidate,
}: {
  children: React.ReactNode;
  className?: string;
  name?: string;
  value?: string;
  formNoValidate?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      name={name}
      value={value}
      formNoValidate={formNoValidate}
    >
      {pending ? (
        <>
          <LoaderCircle size={16} className="spin" />
          Saving…
        </>
      ) : (
        children
      )}
    </button>
  );
}
export function ActionForm({
  intent,
  children,
  label = 'Save changes',
  className = '',
  publicReview = false,
  expectedRevision,
  submit = true,
  captureRevisionOnEdit = false,
}: {
  intent: string;
  children: React.ReactNode;
  label?: string;
  className?: string;
  publicReview?: boolean;
  expectedRevision?: number;
  submit?: boolean;
  captureRevisionOnEdit?: boolean;
}) {
  const [editedRevision, setEditedRevision] = useState<number | undefined>();
  const [state, action] = useActionState<ActionState, FormData>(async (previous, form) => {
    const result = await (publicReview ? decide : perform)(previous, form);
    if (captureRevisionOnEdit && !result.error) setEditedRevision(undefined);
    return result;
  }, {});
  const [copied, setCopied] = useState(false);
  // Keep the revision paired with the user's inputs through search/history navigation.
  // Only a successful save may advance it; an external refresh must not mask a conflict.
  const [initialRevision] = useState(expectedRevision);
  return (
    <form
      action={action}
      className={`form ${className}`}
      onReset={(event) => event.preventDefault()}
      onChange={() => {
        if (captureRevisionOnEdit && editedRevision === undefined)
          setEditedRevision(expectedRevision);
      }}
    >
      <input type="hidden" name="intent" value={intent} />
      {initialRevision !== undefined && (
        <input
          type="hidden"
          name="revision"
          value={
            captureRevisionOnEdit
              ? (editedRevision ?? expectedRevision)
              : (state.revision ?? initialRevision)
          }
        />
      )}
      {children}
      {state.error && (
        <div role="alert" className="notice error">
          {state.error}
        </div>
      )}
      {state.success && (
        <div role="status" className="notice success">
          {state.success}
        </div>
      )}
      {state.link && (
        <div className="copy-link">
          <input
            aria-label={
              intent === 'invite-staff' ? 'Staff invitation link' : 'Customer review link'
            }
            readOnly
            value={state.link}
          />
          <button
            type="button"
            className="button secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(state.link!);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? <Check size={16} /> : <Clipboard size={16} />} {copied ? 'Copied' : 'Copy'}
          </button>
          <a href={state.link} target="_blank" rel="noreferrer">
            {intent === 'invite-staff' ? 'Open invitation' : 'Open review'}
          </a>
        </div>
      )}
      {submit && <Submit>{label}</Submit>}
    </form>
  );
}
export function Field({
  label,
  name,
  type = 'text',
  required = false,
  defaultValue = '',
  placeholder,
  help,
  maxLength,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  help?: string;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <label className="field">
      <span>
        <span id={id + '-label'}>{label}</span>
        {required && (
          <span className="required" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </span>
      <input
        id={id}
        aria-labelledby={id + '-label'}
        aria-describedby={help ? id + '-help' : undefined}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        maxLength={maxLength || 500}
        minLength={type === 'password' ? 12 : undefined}
      />
      {help && <small id={id + '-help'}>{help}</small>}
    </label>
  );
}
export function Textarea({
  label,
  name,
  defaultValue = '',
  required = false,
  help,
  maxLength,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  help?: string;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <label className="field">
      <span id={id + '-label'}>{label}</span>
      <textarea
        id={id}
        aria-labelledby={id + '-label'}
        aria-describedby={help ? id + '-help' : undefined}
        name={name}
        defaultValue={defaultValue}
        required={required}
        rows={4}
        maxLength={maxLength}
      />
      {help && <small id={id + '-help'}>{help}</small>}
    </label>
  );
}
export function IntakeForm({ order }: { order: Order }) {
  const [garments, setGarments] = useState<Garment[]>(
    order.garments.length
      ? order.garments
      : [
          {
            description: '',
            color: '',
            sizes: [
              { size: 'S', expected: 0, received: 0 },
              { size: 'M', expected: 0, received: 0 },
              { size: 'L', expected: 0, received: 0 },
              { size: 'XL', expected: 0, received: 0 },
            ],
          },
        ],
  );
  const [spec, setSpec] = useState(
    order.spec.placement
      ? order.spec
      : {
          placement: '',
          design: '',
          dimensions: '',
          thread: '',
          text: '',
          instructions: '',
        },
  );
  const count = totals(garments);
  function sizeChange(gi: number, si: number, key: string, value: string | number) {
    setGarments((current) =>
      current.map((g, i) =>
        i === gi
          ? {
              ...g,
              sizes: g.sizes.map((s, j) => (j === si ? { ...s, [key]: value } : s)),
            }
          : g,
      ),
    );
  }
  return (
    <ActionForm intent="intake" label="Save intake & instructions">
      <input type="hidden" name="order" value={order.id} />
      <input type="hidden" name="revision" value={order.revision} />
      <input type="hidden" name="garments" value={JSON.stringify(garments)} />
      <input type="hidden" name="spec" value={JSON.stringify(spec)} />
      {garments.map((g, gi) => (
        <div className="garment-editor" key={gi}>
          <div className="form-row">
            <label className="field">
              <span>Garment description</span>
              <input
                required
                value={g.description}
                onChange={(e) =>
                  setGarments(
                    garments.map((x, i) => (i === gi ? { ...x, description: e.target.value } : x)),
                  )
                }
              />
            </label>
            <label className="field">
              <span>Color / brand / style</span>
              <input
                value={g.color}
                onChange={(e) =>
                  setGarments(
                    garments.map((x, i) => (i === gi ? { ...x, color: e.target.value } : x)),
                  )
                }
              />
            </label>
          </div>
          <div className="size-table">
            <div className="size-head">
              <span>Size</span>
              <span>Expected</span>
              <span>Received</span>
              <span>Difference</span>
            </div>
            {g.sizes.map((s, si) => (
              <div className="size-row" key={si}>
                <input
                  aria-label={`Group ${gi + 1} size ${si + 1}`}
                  value={s.size}
                  required
                  onChange={(e) => sizeChange(gi, si, 'size', e.target.value)}
                />
                <input
                  aria-label={`${s.size} expected`}
                  type="number"
                  min="0"
                  max="100000"
                  step="1"
                  required
                  value={s.expected}
                  onChange={(e) => sizeChange(gi, si, 'expected', Number(e.target.value))}
                />
                <input
                  aria-label={`${s.size} received`}
                  type="number"
                  min="0"
                  max="100000"
                  step="1"
                  required
                  value={s.received}
                  onChange={(e) => sizeChange(gi, si, 'received', Number(e.target.value))}
                />
                <span className={s.received !== s.expected ? 'danger-text' : ''}>
                  {s.received - s.expected || '—'}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="text-link"
            onClick={() =>
              setGarments(
                garments.map((x, i) =>
                  i === gi
                    ? {
                        ...x,
                        sizes: [...x.sizes, { size: 'Custom', expected: 0, received: 0 }],
                      }
                    : x,
                ),
              )
            }
          >
            + Add size
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button secondary fit"
        onClick={() =>
          setGarments([
            ...garments,
            {
              description: '',
              color: '',
              sizes: [{ size: 'One size', expected: 0, received: 0 }],
            },
          ])
        }
      >
        + Add garment group
      </button>
      <div className={`notice ${count.expected !== count.received ? 'warning' : 'success'}`}>
        {count.received} of {count.expected} garments received.{' '}
        {count.expected !== count.received
          ? 'Resolve every size discrepancy before requesting approval.'
          : 'Counts reconcile.'}
      </div>
      <h3>Decoration instructions</h3>
      <div className="form-grid">
        {(['placement', 'design', 'dimensions', 'thread', 'text', 'instructions'] as const).map(
          (key) => (
            <label key={key} className="field">
              <span>
                {
                  {
                    placement: 'Placement',
                    design: 'Design name',
                    dimensions: 'Dimensions (include units)',
                    thread: 'Thread / colors',
                    text: 'Exact embroidered text',
                    instructions: 'Customer-visible instructions',
                  }[key]
                }
              </span>
              <input
                required={key === 'placement'}
                value={spec[key]}
                maxLength={key === 'instructions' ? 2000 : 500}
                onChange={(e) => setSpec({ ...spec, [key]: e.target.value })}
              />
            </label>
          ),
        )}
      </div>
      <Textarea
        name="reason"
        label="Reason for this intake update"
        required
        help="Saved in order history, including the previous and new quantities."
      />
    </ActionForm>
  );
}
export function ReadyForm({ order }: { order: Order }) {
  const [counts, setCounts] = useState(
    order.garments.map(() => ({ completed: 0, exceptions: 0, reason: '' })),
  );
  return (
    <ActionForm intent="ready" label="Mark ready for pickup">
      <input type="hidden" name="order" value={order.id} />
      <input type="hidden" name="counts" value={JSON.stringify(counts)} />
      {order.garments.map((g, i) => (
        <div key={i}>
          <h3>{g.description}</h3>
          <p className="muted">{totals([g]).received} received. Account for every garment.</p>
          <div className="form-row">
            {(['completed', 'exceptions', 'reason'] as const).map((key) => (
              <label className="field" key={key}>
                <span>
                  {key === 'reason'
                    ? 'Exception reason'
                    : key === 'completed'
                      ? 'Completed'
                      : 'Exceptions'}
                </span>
                <input
                  type={key === 'reason' ? 'text' : 'number'}
                  min="0"
                  step="1"
                  value={counts[i][key]}
                  onChange={(e) =>
                    setCounts(
                      counts.map((c, j) =>
                        j === i
                          ? {
                              ...c,
                              [key]: key === 'reason' ? e.target.value : Number(e.target.value),
                            }
                          : c,
                      ),
                    )
                  }
                />
              </label>
            ))}
          </div>
        </div>
      ))}
    </ActionForm>
  );
}
export function ReviewDecision({ token }: { token: string }) {
  const [choice, setChoice] = useState('approved');
  return (
    <ActionForm
      intent="review"
      label={choice === 'approved' ? 'Approve this exact proof' : 'Send change request'}
      publicReview
    >
      <input name="token" type="hidden" value={token} />
      <div className="decision-tabs">
        <button
          type="button"
          className={choice === 'approved' ? 'selected' : ''}
          onClick={() => setChoice('approved')}
        >
          Approve proof
        </button>
        <button
          type="button"
          className={choice === 'changes_requested' ? 'selected' : ''}
          onClick={() => setChoice('changes_requested')}
        >
          Request changes
        </button>
      </div>
      <input name="choice" type="hidden" value={choice} />
      {choice === 'approved' ? (
        <>
          <Field name="name" label="Your full name" required maxLength={160} />
          <label className="check-field">
            <input name="design" type="checkbox" required />
            {DESIGN_CONFIRMATION}
          </label>
          <label className="check-field">
            <input name="policy" type="checkbox" required />
            {POLICY_CONFIRMATION}
          </label>
        </>
      ) : (
        <Textarea name="comments" label="What would you like changed?" required />
      )}
      <p className="fine-print">
        This link grants access to this proof. Your typed name records an acknowledgment; it does
        not verify your identity.
      </p>
    </ActionForm>
  );
}
