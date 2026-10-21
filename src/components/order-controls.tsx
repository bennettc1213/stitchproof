'use client';

import { useFormStatus } from 'react-dom';
import { useId } from 'react';
import type { AssignmentMember, Order } from '@/lib/domain';
import { ActionForm, Textarea } from './forms';

function ControlButton({ operation, children }: { operation: string; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="operation"
      value={operation}
      disabled={pending}
      className="button secondary"
    >
      {pending ? 'Saving…' : children}
    </button>
  );
}

export function AssignmentLabel({
  order,
  members,
}: {
  order: Pick<Order, 'assigned_to' | 'assigned_label'>;
  members: AssignmentMember[];
}) {
  const active = members.find((m) => m.user_id === order.assigned_to);
  return (
    <span>
      {!order.assigned_to
        ? 'Unassigned'
        : active
          ? active.email
          : `Former team member${order.assigned_label ? ' · ' + order.assigned_label : ''}`}
    </span>
  );
}

export function OrderControls({
  order,
  members,
  readOnly,
}: {
  order: Order;
  members: AssignmentMember[];
  readOnly: boolean;
}) {
  const terminal = ['completed', 'cancelled'].includes(order.lifecycle);
  const assignmentLabelId = useId();
  const active = members.some((m) => m.user_id === order.assigned_to);
  return (
    <>
      <p className="order-assignee">
        <strong>Assigned to</strong>
        <AssignmentLabel order={order} members={members} />
      </p>
      {readOnly ? (
        <p className="muted">
          Your shop is read-only. Assignment and order controls are unavailable.
        </p>
      ) : (
        <ActionForm
          key={order.id}
          intent="order-control"
          expectedRevision={order.revision}
          captureRevisionOnEdit
          submit={false}
        >
          <input type="hidden" name="order" value={order.id} />
          {!terminal && !order.archived_at && (
            <>
              <label className="field">
                <span id={assignmentLabelId}>Assign team member</span>
                <select
                  aria-labelledby={assignmentLabelId}
                  name="assigned_to"
                  defaultValue={active ? order.assigned_to || '' : ''}
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.email} ({m.role})
                    </option>
                  ))}
                </select>
              </label>
              <ControlButton operation="assign">Save assignment</ControlButton>
            </>
          )}
          {['draft', 'open'].includes(order.lifecycle) && (
            <details className="edit-disclosure">
              <summary>Cancel this order</summary>
              <p className="muted">
                Cancellation closes this job and revokes pending customer review links. It preserves
                garments, files, decisions, and history. There is no reopen action.
              </p>
              <Textarea
                name="reason"
                label="Cancellation reason"
                maxLength={1000}
                help="Record 3–1,000 characters. Visible only to your shop."
              />
              <label className="check-field">
                <input type="checkbox" name="confirm_cancel" />I confirm this order should be
                cancelled.
              </label>
              <ControlButton operation="cancel">Cancel order</ControlButton>
            </details>
          )}
          {terminal && (
            <>
              <p className="muted">
                {order.archived_at
                  ? 'Restore visibility without changing the order’s status.'
                  : 'Hide this order from the current list. Its files and history remain available.'}
              </p>
              <ControlButton operation={order.archived_at ? 'restore' : 'archive'}>
                {order.archived_at ? 'Restore to current list' : 'Archive order'}
              </ControlButton>
            </>
          )}
        </ActionForm>
      )}
    </>
  );
}
