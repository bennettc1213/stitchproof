import { ActionForm, Field } from './forms';

export type TeamDetails = {
  members: { user_id: string; email: string; role: 'owner' | 'staff' }[];
  invitations: { id: string; email: string; expires_at: string }[];
};

export function Team({ details }: { details: TeamDetails }) {
  return (
    <>
      <p>One owner and two staff. Pending invitations reserve a staff seat for seven days.</p>
      {details.members.map((member) => (
        <div className="panel" key={member.user_id}>
          <p>
            <strong>{member.email}</strong> · {member.role === 'owner' ? 'Owner' : 'Staff'}
          </p>
          {member.role === 'staff' && (
            <ActionForm intent="remove-staff" label="Remove staff access">
              <input type="hidden" name="user" value={member.user_id} />
              <label className="check-field">
                <input type="checkbox" name="confirm" required />
                Remove this person’s access to shop records immediately.
              </label>
            </ActionForm>
          )}
        </div>
      ))}
      <h3>Pending invitations</h3>
      {details.invitations.length === 0 && <p className="muted">No pending invitations.</p>}
      {details.invitations.map((invite) => (
        <div className="panel" key={invite.id}>
          <p>
            <strong>{invite.email}</strong>
          </p>
          <p className="fine-print">
            Expires {new Date(invite.expires_at).toISOString().slice(0, 10)} (UTC).
          </p>
          <ActionForm intent="revoke-invitation" label="Revoke invitation">
            <input type="hidden" name="invitation" value={invite.id} />
          </ActionForm>
        </div>
      ))}
      <h3>Invite a staff member</h3>
      <p className="muted">
        Create a private link and share it with the person below. They must verify and sign in with
        that exact email.
      </p>
      <ActionForm intent="invite-staff" label="Create invitation link">
        <Field name="email" label="Staff email address" type="email" maxLength={254} required />
        <label className="check-field">
          <input type="checkbox" name="queue_email" />
          Also queue an invitation email. Delivery depends on the shop’s email configuration.
        </label>
      </ActionForm>
    </>
  );
}
