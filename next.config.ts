import type { NextConfig } from 'next';
// Fail production builds and starts outright on development-only or unsafe settings. The
// runtime guards (src/lib/config.ts, email.ts, billing-domain.ts) still apply; this makes a
// misconfigured deployment fail at deploy time instead of serving error pages.
if (process.env.NODE_ENV === 'production') {
  const env = process.env;
  const problems = [
    env.ALLOW_DEV_SEED === 'true' && 'ALLOW_DEV_SEED must not be true',
    env.EMAIL_TRANSPORT === 'local' && 'EMAIL_TRANSPORT=local is development-only',
    (env.STRIPE_MODE === 'live' || env.STRIPE_SECRET_KEY?.startsWith('sk_live_')) &&
      !(env.STRIPE_MODE === 'live' && env.STRIPE_ALLOW_LIVE === 'true') &&
      'live Stripe requires STRIPE_MODE=live and STRIPE_ALLOW_LIVE=true',
    env.APP_URL && !env.APP_URL.startsWith('https://') && 'APP_URL must use https://',
  ].filter(Boolean);
  if (problems.length)
    throw new Error(
      `Refusing a production build/start: ${problems.join('; ')}. For a local production build, run with EMAIL_TRANSPORT=unconfigured and APP_URL=https://… set.`,
    );
}
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  experimental: { serverActions: { bodySizeLimit: '12mb' } },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      {
        source: '/invite/:path*',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
      {
        source: '/review/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};
export default config;
