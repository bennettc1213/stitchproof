import Link from 'next/link';
import { Logo } from './ui';
import { ActionForm, Field } from './forms';
import { configured } from '@/lib/config';
import { authNext } from '@/lib/auth-next';
export function AuthPage({
  kind,
  next,
}: {
  kind: 'login' | 'signup' | 'forgot' | 'reset';
  next?: string;
}) {
  const destination = authNext(next);
  const nextQuery = destination.startsWith('/invite/')
    ? '?next=' + encodeURIComponent(destination)
    : '';
  const signup = kind === 'signup',
    login = kind === 'login';
  const title = {
    login: 'Welcome back.',
    signup: 'A little more clarity starts here.',
    forgot: 'Let’s get you back in.',
    reset: 'Choose a new password.',
  }[kind];
  return (
    <div className="auth-layout">
      <aside className="auth-aside">
        <Logo />
        <div>
          <span className="eyebrow">MADE FOR THE DETAILS</span>
          <h2>
            Good work starts
            <br />
            with everyone
            <br />
            <em>on the same page.</em>
          </h2>
          <p>
            Intake, approval, pickup.
            <br />
            One clear thread from start to finish.
          </p>
          <div className="auth-stitch" aria-hidden="true">
            ┄┄┄┄┄✳
          </div>
        </div>
        <small>StitchProof · Built for independent embroidery shops</small>
      </aside>
      <main className="auth-main" id="main-content">
        <div className="auth-card">
          <Link href="/" className="back-link">
            ← Back to StitchProof
          </Link>
          <h1>{title}</h1>
          <p>
            {signup
              ? 'Start with a seven-day trial. No payment card required.'
              : login
                ? 'Your shop, right where you left it.'
                : 'Use the email address associated with your shop.'}
          </p>
          {!configured() ? (
            <div className="notice warning">
              <strong>Workspace setup is needed.</strong>
              <p>
                Supabase isn’t connected on this machine yet. Authentication and real shop records
                become available after the setup in README.md.
              </p>
              <Link href="/demo" className="text-link">
                Explore the fictional demo →
              </Link>
            </div>
          ) : (
            <ActionForm
              intent={kind === 'reset' ? 'update-password' : kind}
              label={
                signup
                  ? 'Create your account'
                  : login
                    ? 'Log in'
                    : kind === 'forgot'
                      ? 'Request reset link'
                      : 'Update password'
              }
            >
              <input type="hidden" name="next" value={destination} />
              {kind !== 'reset' && (
                <Field
                  name="email"
                  label="Email address"
                  type="email"
                  placeholder="you@yourshop.com"
                  required
                />
              )}
              {kind !== 'forgot' && (
                <Field
                  name="password"
                  label="Password"
                  type="password"
                  required
                  help="At least 12 characters."
                />
              )}
              {signup && (
                <p className="fine-print">
                  By creating an account, you agree to the <Link href="/terms">terms</Link> and
                  acknowledge the <Link href="/privacy">privacy notice</Link>. Draft policies
                  require founder review before launch.
                </p>
              )}
            </ActionForm>
          )}
          {login && (
            <Link href="/forgot-password" className="text-link">
              Forgot your password?
            </Link>
          )}
          <div className="auth-alternative">
            {signup ? 'Already have a shop?' : 'New to StitchProof?'}{' '}
            <Link href={(signup ? '/login' : '/signup') + nextQuery}>
              {signup ? 'Log in' : 'Start your shop'}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
