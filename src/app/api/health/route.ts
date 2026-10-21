import { configured } from '@/lib/config';
import { emailConfiguration } from '@/lib/email';
import { billingConfiguration } from '@/lib/billing-domain';
import { authLimitsConfigured } from '@/lib/auth-limit-policy';
export async function GET() {
  return Response.json(
    {
      status: 'ok',
      database: configured() ? 'configured-unverified' : 'not-configured',
      authentication_limits: authLimitsConfigured() ? 'configured-unverified' : 'not-configured',
      billing: billingConfiguration() ? 'configured-unverified' : 'not-configured',
      email: {
        unconfigured: 'not-configured',
        local: 'development-outbox',
        resend: 'configured-unverified',
      }[emailConfiguration()],
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
