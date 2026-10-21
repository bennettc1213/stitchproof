import Link from 'next/link';
import { Check, ExternalLink, ImageIcon, LockKeyhole, Mail, Users } from 'lucide-react';
import { Section } from './ui';
import { ActionForm, Field, Submit, Textarea } from './forms';
import { Team, type TeamDetails } from './team';
import { EmailStatuses, type EmailStatus } from './email-status';
import { Billing } from './billing';
import type { BillingSummary } from '@/lib/billing-domain';
import type { ShopLogo } from '@/lib/shop-logo';
type Shop = {
  name: string;
  timezone: string;
  policy: string;
  policy_version: number;
  contact_email: string;
  trial_ends_at: string;
  storage_used: number;
  storage_limit: number;
};
export function Settings({
  shop,
  demo = false,
  tab = 'shop',
  owner = true,
  team,
  email = 'unconfigured',
  messages,
  billing,
  billingMode = 'unconfigured',
  logo = null,
}: {
  shop: Shop;
  demo?: boolean;
  tab?: string;
  owner?: boolean;
  team?: TeamDetails;
  email?: 'unconfigured' | 'local' | 'resend';
  messages?: EmailStatus[];
  billing?: BillingSummary;
  billingMode?: 'test' | 'live' | 'unconfigured';
  logo?: ShopLogo | null;
}) {
  const base = demo ? '/demo' : '/app';
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">A PLACE FOR THE ESSENTIALS</span>
          <h1>Shop settings</h1>
          <p>Your shop’s identity, your team, and how things run.</p>
        </div>
      </div>
      <div className="settings-tabs">
        {['shop', 'team', 'billing', 'data'].map((t) => (
          <Link key={t} className={tab === t ? 'selected' : ''} href={base + '/settings/' + t}>
            {
              {
                shop: 'Shop profile',
                team: 'Team',
                billing: 'Plan & billing',
                data: 'Your data',
              }[t]
            }
          </Link>
        ))}
      </div>
      <div className="settings-layout">
        {tab === 'shop' ? (
          <Section title="Shop profile" kicker="THE DETAILS YOUR CUSTOMERS SEE">
            <LogoSettings logo={logo} shopName={shop.name} editable={!demo && owner} demo={demo} />
            <div className="mini-divider" />
            {demo || !owner ? (
              <>
                <dl className="spec-grid">
                  {Object.entries({
                    'Shop name': shop.name,
                    Timezone: shop.timezone,
                    'Contact email': shop.contact_email || 'Not set',
                    'Policy version': shop.policy_version,
                  }).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="policy-text">
                  <h3>Shop policy</h3>
                  <p>{shop.policy || 'No policy supplied yet.'}</p>
                </div>
              </>
            ) : (
              <ActionForm intent="shop" label="Save shop profile">
                <Field name="name" label="Shop name" defaultValue={shop.name} required />
                <Field
                  name="timezone"
                  label="IANA timezone"
                  defaultValue={shop.timezone}
                  required
                />
                <Field
                  name="contact_email"
                  label="Customer contact email"
                  type="email"
                  defaultValue={shop.contact_email}
                />
                <Textarea
                  label="Your customer-supplied garment policy"
                  name="policy"
                  defaultValue={shop.policy}
                  help="Changing policy requires a fresh approval before production starts. Existing proof snapshots are preserved."
                />
              </ActionForm>
            )}
            {!demo && owner && messages && (
              <>
                <div className="mini-divider" />
                <EmailStatuses messages={messages} />
              </>
            )}
          </Section>
        ) : tab === 'billing' ? (
          <Section title="One plan. Everything connected." kicker="THE SHOP PLAN">
            <div className="price">
              $39<span>USD / month</span>
            </div>
            <ul className="plan-features">
              {[
                '1 owner + 2 staff',
                '2 GiB private file storage',
                '7-day app-managed trial',
                'Core order-to-pickup workflow',
              ].map((f) => (
                <li key={f}>
                  <Check size={15} />
                  {f}
                </li>
              ))}
            </ul>
            {!demo && owner && billing ? (
              <Billing summary={billing} mode={billingMode} />
            ) : (
              <div className="notice warning">
                <LockKeyhole size={17} />
                <span>
                  {demo
                    ? 'Billing is not connected in this public demo. No payment is collected here.'
                    : 'Only the shop owner can manage billing.'}
                </span>
              </div>
            )}
            <p className="fine-print">
              Paid checkout starts the subscription immediately. An expired shop retains read,
              export, and billing access. Existing sent reviews remain actionable until their own
              expiry.
            </p>
          </Section>
        ) : tab === 'team' ? (
          <Section title="A small team, in sync">
            <Users size={28} />
            <h3>{demo ? 'Cedar Stitch Demo owner' : 'Your shop team'}</h3>
            <p className="muted">
              A workspace for one owner and up to two staff members. Keep your shop’s orders and
              customer details together as a team.
            </p>
            {demo ? (
              <p className="notice">
                Team changes require a real workspace. This tour is read-only.
              </p>
            ) : owner && team ? (
              <Team details={team} />
            ) : (
              <p className="notice">Only the shop owner can invite or remove staff.</p>
            )}
          </Section>
        ) : (
          <Section title="Your records belong to your shop">
            <p>
              Download structured customer, order, approval, and history records. Attachments are
              separate binary files; a data export includes an authorized download manifest.
            </p>
            {demo ? (
              <p className="notice">
                Public demo records are fictional. Workspace export requires an authenticated owner.
              </p>
            ) : owner ? (
              <Link href="/api/export" className="button primary">
                <ExternalLink size={15} />
                Download workspace JSON
              </Link>
            ) : (
              <p className="notice">Only the shop owner can export workspace data.</p>
            )}
            <div className="mini-divider" />
            <h3>Workspace closure</h3>
            <p className="muted">
              Subscription cancellation does not delete records. A verified owner can request
              closure through the founder-run procedure in the operating documentation. Self-service
              deletion is not available yet.
            </p>
          </Section>
        )}
        <aside>
          <Section title="Email delivery">
            <Mail size={23} />
            <h3>
              {demo || email === 'unconfigured'
                ? 'Not configured'
                : email === 'local'
                  ? 'Development outbox'
                  : 'Resend configured'}
            </h3>
            <p className="muted">
              {demo || email === 'unconfigured'
                ? 'Create and copy private links, or queue messages for later. Configure email and a scheduled worker before expecting delivery.'
                : email === 'local'
                  ? 'The worker writes messages to local files for testing. No email is sent.'
                  : 'Queued messages need the scheduled email worker. See recent results under Shop profile.'}
            </p>
            <p className="fine-print">Creating a link never means an email was delivered.</p>
          </Section>
          <Section title="Private by design">
            <p className="muted">
              Shop-scoped database access and private file storage. Customer review pages contain
              only the approved-for-review bundle.
            </p>
          </Section>
        </aside>
      </div>
    </>
  );
}
function LogoSettings({
  logo,
  shopName,
  editable,
  demo,
}: {
  logo: ShopLogo | null;
  shopName: string;
  editable: boolean;
  demo: boolean;
}) {
  return (
    <div className="logo-settings">
      <div className="logo-preview" data-empty={logo ? undefined : ''}>
        {logo ? (
          // Native image supports the authorization-checked same-origin logo route.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo.url} alt={`${shopName} logo`} width={logo.width} height={logo.height} />
        ) : (
          <>
            <ImageIcon size={22} aria-hidden="true" />
            <span>No logo yet</span>
          </>
        )}
      </div>
      <div className="logo-settings-body">
        <h3>Shop logo</h3>
        <p className="muted">
          Shown in your workspace, on customer proof pages, and at the top of order sheets and
          approval PDFs.
        </p>
        {editable ? (
          // One form for upload and removal keeps its result message visible after either.
          <ActionForm intent="shop-logo" submit={false}>
            <label className="field">
              <span>{logo ? 'New logo image' : 'Logo image'}</span>
              <input
                type="file"
                name="logo"
                accept="image/png,image/jpeg,image/webp"
                aria-describedby="logo-help"
                required
              />
              <small id="logo-help">
                PNG, JPEG, or WebP up to 5 MiB, at least 32 × 32 pixels. A transparent PNG looks
                best. Images are stored privately and resized to fit 1024 pixels.
              </small>
            </label>
            <Submit name="operation" value="upload">
              {logo ? 'Replace logo' : 'Upload logo'}
            </Submit>
            {logo && (
              <details className="logo-remove">
                <summary>Remove logo</summary>
                <label className="check-field">
                  <input type="checkbox" name="confirm" />I confirm the logo should be removed
                  everywhere. The shop name is shown instead.
                </label>
                <Submit name="operation" value="remove" className="button secondary" formNoValidate>
                  Remove logo
                </Submit>
              </details>
            )}
          </ActionForm>
        ) : (
          <p className="fine-print">
            {demo
              ? 'Logo uploads require a real workspace. This tour is read-only.'
              : 'Only the shop owner can change the logo.'}
          </p>
        )}
      </div>
    </div>
  );
}
