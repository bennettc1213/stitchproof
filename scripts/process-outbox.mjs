const origin = new URL(process.env.APP_URL || 'http://127.0.0.1:3000');
if (!['localhost', '127.0.0.1'].includes(origin.hostname) && origin.protocol !== 'https:')
  throw new Error('Email worker requires HTTPS or localhost.');
if (!process.env.OUTBOX_WORKER_SECRET || process.env.OUTBOX_WORKER_SECRET.length < 32)
  throw new Error('Set a random OUTBOX_WORKER_SECRET of at least 32 characters.');
const response = await fetch(new URL('/api/internal/outbox', origin), {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + process.env.OUTBOX_WORKER_SECRET },
  signal: AbortSignal.timeout(60000),
});
if (!response.ok)
  throw new Error(
    'Email worker returned HTTP ' +
      response.status +
      '. Check server configuration; no delivery is claimed.',
  );
console.log(JSON.stringify(await response.json()));
