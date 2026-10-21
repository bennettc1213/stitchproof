import { configured } from '@/lib/config';
import { authLimitsConfigured } from '@/lib/auth-limit-policy';

export const dynamic = 'force-dynamic';
export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  if (!configured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ ready: false, services: 'not-configured' }, { status: 503, headers });
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const origin = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const probe = async (path: string, check?: (value: unknown) => boolean) => {
    try {
      const response = await fetch(new URL(path, origin), {
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
          Authorization: 'Bearer ' + key,
        },
      });
      if (!response.ok) return 'unavailable';
      return !check || check(await response.json()) ? 'healthy' : 'unavailable';
    } catch {
      return 'unavailable';
    }
  };
  const [database, auth, storage, authentication_limits] = await Promise.all([
    probe('/rest/v1/workspaces?select=id&limit=1'),
    probe('/auth/v1/health'),
    probe(
      '/storage/v1/bucket/order-files',
      (value) =>
        typeof value === 'object' && value !== null && 'public' in value && value.public === false,
    ),
    authLimitsConfigured()
      ? probe('/rest/v1/auth_attempt_limits?select=window_start&limit=0')
      : Promise.resolve('not-configured'),
  ]);
  const ready = [database, auth, storage, authentication_limits].every(
    (state) => state === 'healthy',
  );
  return Response.json(
    { ready, database, auth, storage, authentication_limits },
    { status: ready ? 200 : 503, headers },
  );
}
