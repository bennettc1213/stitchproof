import { redirect } from 'next/navigation';
import { configured } from '@/lib/config';
import { supabase } from '@/lib/supabase/server';
import { Logo } from '@/components/ui';
import { ActionForm, Field, Textarea } from '@/components/forms';
export default async function Page() {
  if (!configured()) redirect('/login?setup=1');
  const db = await supabase();
  const { data } = await db.auth.getClaims();
  if (!data?.claims) redirect('/login');
  const { data: member } = await db
    .from('memberships')
    .select('workspace_id')
    .eq('user_id', data.claims.sub)
    .single();
  if (member) redirect('/app/orders');
  return (
    <main className="onboarding" id="main-content">
      <Logo />
      <span className="eyebrow">LET’S GET YOUR SHOP SETTLED</span>
      <h1>Make yourself at home.</h1>
      <p>A few details, then you’re ready for your first order.</p>
      <ActionForm intent="onboard" label="Create my shop">
        <Field name="name" label="Shop name" required />
        <Field
          name="timezone"
          label="IANA timezone"
          defaultValue="America/Los_Angeles"
          required
          help="For example America/New_York or Europe/London."
        />
        <label className="field">
          <span>Shop logo (optional)</span>
          <input
            type="file"
            name="logo"
            accept="image/png,image/jpeg,image/webp"
            aria-describedby="onboarding-logo-help"
          />
          <small id="onboarding-logo-help">
            PNG, JPEG, or WebP up to 5 MiB. You can add or change it later in Shop settings.
          </small>
        </label>
        <Textarea
          name="policy"
          label="Your existing customer-supplied garment policy"
          help="This appears with proofs. Supply your own reviewed policy; StitchProof does not provide legal terms for your shop."
        />
      </ActionForm>
    </main>
  );
}
