import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { configured } from '@/lib/config';
import { supabase } from '@/lib/supabase/server';
import { AuthPage } from '@/components/auth-page';
import { ActionForm } from '@/components/forms';
import { Logo } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Join a shop',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();
  const next = '/invite/' + token;
  if (!configured()) return <AuthPage kind="login" next={next} />;
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return <AuthPage kind="login" next={next} />;
  return (
    <main className="auth-main" id="main-content">
      <div className="auth-card">
        <Logo />
        <h1>Join your shop team.</h1>
        <p>Signed in as {user.email}. Your verified email must match the invitation.</p>
        <ActionForm intent="accept-invitation" label="Accept invitation">
          <input type="hidden" name="token" value={token} />
          <p>
            Invitations expire after seven days and can only be used by the intended account. An
            account can belong to one shop.
          </p>
        </ActionForm>
        <ActionForm intent="logout" label="Sign out to use another account">
          <input type="hidden" name="next" value={next} />
        </ActionForm>
      </div>
    </main>
  );
}
