// Only these local destinations may survive an authentication round trip.
export function authNext(value: unknown): string {
  if (value === '/reset-password') return value;
  if (typeof value === 'string' && /^\/invite\/[a-f0-9]{64}$/.test(value)) return value;
  return '/app/orders';
}
