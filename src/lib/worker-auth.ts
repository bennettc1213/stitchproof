import { timingSafeEqual } from 'node:crypto';

export function authorizedWorker(request: Request) {
  const secret = process.env.OUTBOX_WORKER_SECRET;
  const supplied = request.headers.get('authorization') || '';
  const expected = 'Bearer ' + secret;
  return Boolean(
    secret &&
    secret.length >= 32 &&
    Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)),
  );
}
