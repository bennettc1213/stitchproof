import { ActionForm } from './forms';

export type EmailStatus = {
  id: string;
  order_id: string | null;
  template: string;
  recipient: string;
  state: string;
  attempts: number;
  error_code: string | null;
  next_attempt_at: string;
};
const labels: Record<string, string> = {
  queued: 'Queued',
  accepted_by_provider: 'Accepted by provider',
  delivered: 'Delivered',
  failed: 'Failed',
  development_outbox: 'Written to development outbox',
};
export function EmailStatuses({ messages }: { messages: EmailStatus[] }) {
  return (
    <>
      <h3>Recent emails</h3>
      {messages.length === 0 && <p className="muted">No transactional emails queued yet.</p>}
      {messages.map((message) => (
        <div className="panel" key={message.id}>
          <p>
            <strong>{message.recipient}</strong> · {message.template}
          </p>
          <p>
            {labels[message.state] || message.state} · {message.attempts} attempts
          </p>
          {message.error_code && (
            <p className="fine-print">Last result: {message.error_code.replaceAll('_', ' ')}</p>
          )}
          {message.state === 'queued' && (
            <p className="fine-print">
              Next attempt after{' '}
              {new Date(message.next_attempt_at).toISOString().replace('T', ' ').slice(0, 19)} UTC,
              when the worker runs.
            </p>
          )}
          {message.state === 'failed' &&
            message.attempts < 6 &&
            !['link_inactive', 'retry_window_expired', 'order_not_ready'].includes(
              message.error_code || '',
            ) && (
              <ActionForm intent="retry-email" label="Queue retry">
                <input name="email_id" type="hidden" value={message.id} />
              </ActionForm>
            )}
        </div>
      ))}
      <p className="fine-print">
        Provider acceptance does not confirm delivery to an inbox. Development outbox messages are
        local files and have not been sent.
      </p>
    </>
  );
}
