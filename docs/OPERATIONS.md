# Operations and recovery

This is the current operating state and the remaining launch work. Instructions are not evidence of a deployed service or existing backup.

## Local services and configuration

Run `pnpm db:start` with Docker Desktop running, then `pnpm exec supabase migration up --local` and `pnpm db:configure`. The configuration command saves keys to ignored `.env.local` without logging them and refuses existing remote database configuration. `db:reset` is only for an explicitly disposable database and destroys local records. Normal `supabase stop` preserves local data; never add `--no-backup` when preserving records. Restart Next after environment changes if it does not reload them. The mail catcher uses `[local_smtp]` at port 54324. Local analytics is disabled because Windows log collection otherwise requires an unnecessary Docker TCP endpoint.

`/api/health` reports safe process/configuration state without keys. `/api/ready` additionally probes the database, Auth, private `order-files` bucket, and authentication-limit configuration/table access with bounded timeouts, returning only service health and HTTP 200/503. It has returned healthy against the running local services. It does not prove billing, provider email, backups, or complete application correctness.

Never expose local development ports with a tunnel as part of ordinary preview. No deployment is configured. Review links use validated `APP_URL`, never the request's Host header. Production will require an HTTPS origin, correctly configured auth redirect allowlists, and HTTPS proxy/cookie testing. Runtime rejects `ALLOW_DEV_SEED=true` in production. The seed script also requires a loopback Supabase host.

## Migrations and authorization

Set a stable random server-only `AUTH_RATE_LIMIT_SECRET` (32–4096 characters) identically on every app instance. Local `pnpm db:configure` generates it only when absent. Apply migration `202610210013_auth_limits.sql` before serving authentication actions. Missing/invalid secret or failed guard RPC denies attempts with a generic availability error; `/api/ready` also requires the secret and private counter-table access. This probe checks availability, not behavioral enforcement.

The app uses fixed-window normalized-email/action counters: login 10/10 minutes, signup 3/hour, recovery 3/15 minutes; global ceilings are respectively 300/minute, 60/minute and 60/minute. All attempts count, including success. Keep Supabase provider Auth limits enabled: direct public Auth requests bypass app server actions. Tune global ceilings against expected traffic and monitor aggregate denials without logging submitted emails. Secret rotation starts new identity buckets; use deliberately and consistently. Do not expose the secret or counters to clients. Opportunistic cleanup removes at most 100 rows older than two hours per call; retention is not a strict two-hour deletion guarantee.

`pnpm test:auth-security` passed shared parallel counters, private counter permissions, browser throttling/reload/input retention, signed expired local ES256 tokens rejected for expiry by Auth, SSR/proxy and private API refresh, concurrent refresh, invalid refresh and tampered-token denial. This explicitly guarded local-only script reads matching Docker Auth signing configuration in memory, never writes/logs keys or session values, and writes only safe pass metadata to `.local/auth-security-check.json`. Hosted HTTPS/cookie behavior still needs staging verification.

Apply the committed `supabase/migrations` files in order to a fresh authorized development project. For production, first back up the database and files, apply/verify against staging, review grants and RLS, and then use the Supabase migration workflow. Avoid applying hand-edited SQL only in a hosted dashboard without recording the migration.

The app's authenticated role receives scoped SELECT and explicit function grants. Sensitive review-token and outbox columns are not readable to normal sessions. `service_role` is server-only and bypasses RLS; service code must retain its explicit scope checks. Do not expose it to browser bundles.

Use forward corrective migrations for live fixes. A destructive rollback or `db:reset` is not a production rollback strategy. Export data before schema changes and verify restoration into an isolated environment.

## Email worker and delivery

Account verification and recovery use Supabase Auth. Locally they are caught by the local mail service. Production needs verified SMTP sender setup in Supabase and a working redirect configuration.

Review and invitation forms queue emails only when explicitly selected. Decisions queue owner notifications transactionally; ready orders have a deduplicated pickup-notice action. Opening records and seeds never dispatch. An unconfigured provider leaves messages queued and accurately labeled.

Configure `EMAIL_TRANSPORT=local` for development files, or `resend` with `RESEND_API_KEY` and a verified plain sender address in `EMAIL_FROM`. `local` requires loopback Supabase and is rejected in production. Set a random server-only `OUTBOX_WORKER_SECRET` of at least 32 characters. `pnpm email:work` invokes one batch using `.env.local`. Production scheduling must POST `/api/internal/outbox` every minute with `Authorization: Bearer <secret>`; GET or an invalid/missing secret cannot invoke the worker. The preview deployment schedules this from Supabase with `pg_cron` and `pg_net` (set up October 22, 2026), because Vercel Hobby cron runs only daily. The worker secret is stored in Supabase Vault as `stitchproof_worker_secret` and must equal Vercel's `OUTBOX_WORKER_SECRET`. If you rotate one, rotate both. The jobs are:

```sql
-- every minute: email outbox; hourly at :17: abandoned-upload cleanup; daily: trim cron logs
select cron.schedule('stitchproof-outbox', '* * * * *', $cron$
  select net.http_post(
    url := 'https://stitchproof-five.vercel.app/api/internal/outbox',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'stitchproof_worker_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 55000)
$cron$);
-- 'stitchproof-file-cleanup' at '17 * * * *' posts to /api/internal/files the same way.
select cron.schedule('stitchproof-cron-log-trim', '41 3 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$);
```

Check runs with `select * from cron.job_run_details order by start_time desc limit 5` and responses with `select status_code, content from net._http_response order by created desc limit 5`.

The worker claims up to five rows with `FOR UPDATE SKIP LOCKED`, individual lease tokens, and two-minute leases. It sends synchronously within the job request and finalizes results durably. Expired leases can be reclaimed after a crash. Resend calls use an eight-second timeout and a stable per-job idempotency key. Failed attempts back off 1, 2, 4, 8, then 16 minutes, stopping after six attempts; processing/retries also stop 23 hours after the first attempt, within Resend's documented 24-hour idempotency window. Do not manually reset attempt timestamps or IDs to retry uncertain provider acceptance after this window. Review the provider record and create a deliberate new request if needed. Owners can inspect the last 30 safe status records and request eligible retries under Shop profile.

`accepted_by_provider` requires a provider reference and never means inbox delivery. A delivery webhook is not implemented, so this worker never marks messages `delivered`. Local transport writes ignored `.local/outbox/<job-id>.json` and records `development_outbox`; it never calls an email provider. The files contain synthetic recipients/private links and should be removed after local testing. Only safe job/template/state/attempt/error codes enter order history; no message bodies or tokens are logged.

Review/invitation bearer tokens are stored temporarily only in server-only queued payloads. The worker purges payloads after acceptance/local write, cancels unsent expired/revoked/replaced links, and purges failed messages after the 23-hour window. These cleanup operations require the scheduler to run. Provider email retention is separate and must be configured/documented before launch. Production sender contact/domain belongs to the founder; no address is invented here. References: [Resend sending API](https://resend.com/docs/api-reference/emails/send-email), [idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).

SQL/template tests and `pnpm test:email` pass against real local Supabase, including parallel authenticated workers, local files, safe states, and payload cleanup. Crash/lease failure recovery has SQL coverage; actual provider acceptance, provider failure handling, and production sender/scheduler setup remain unverified. Local Auth signup/recovery emails have separately passed through the mail catcher.

## Stripe billing — test mode verified

The code uses Stripe SDK 23.0.0 with API `2026-09-30.endive`, hosted Checkout and Customer Portal, and `/api/stripe/webhook`. Test-mode verification passed on October 21, 2026 (`pnpm test:stripe`). No live object or charge has been created. On this API version, the Portal schedules period-end cancellation through `cancel_at` and leaves `cancel_at_period_end` false; reconciliation treats either as scheduled. Concurrent webhooks for the same customer wait briefly for the reconciliation lease instead of returning 503, so a burst of checkout events does not defer entitlement to Stripe's next retry. The UI accurately shows unconfigured until all required values are set. The seven-day no-card trial remains application-managed; no Stripe trial is created.

Configure test `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, and `STRIPE_PORTAL_CONFIGURATION_ID`; use `STRIPE_MODE=test`. The price must be $39 USD, recurring every month, quantity one/licensed, without a provider trial or quantity transformation. Card payments must be enabled. Configure the Portal to cancel at period end and disable plan switching. The app validates these provider objects server-side. Production live mode additionally requires `STRIPE_ALLOW_LIVE=true`; local processes reject live keys.

Owners alone can initiate billing through server actions and owner-checked RPCs, even when work entitlement expired. A checkout operation holds a two-minute database lease. Customer creation and one-hour checkout generations use stable provider idempotency keys; existing open sessions are reused/recovered, and existing nonterminal subscriptions block a second checkout. An uncertain expired session is never silently replaced before its reserved window ends. Missing credentials do not block valid trial work.

The webhook verifies the untouched raw bytes and signature, enforces a 1 MiB body limit, validates test/live mode, resolves only server-associated customers, deduplicates committed event IDs, and serializes fresh provider reconciliation per customer. It subscribes to snapshot checkout completion, subscription created/updated/deleted, and invoice paid/payment success/failure events. Configure the endpoint API version consistently; use Stripe CLI forwarding to `127.0.0.1:3000/api/stripe/webhook` during test mode. A failed reconciliation returns non-2xx so Stripe retries; it never acknowledges an uncommitted entitlement update. Owner **Refresh billing status** also reconciles current provider state.

An active subscription extends paid-through only when the current invoice is paid. The current subscription item supplies the paid period end. A scheduled cancellation retains that paid time; final termination caps access at the actual end. Payment failure persists its first failure anchor and a three-day grace, without extending it on retries or stale events; confirmed recovery clears it. Browser checkout-return URLs never grant access. Expired access preserves records, exports, billing, and valid already-sent customer decisions.

SQL tests cover leases, authorization, deduplication, expiry, grace, recovery, and cancellation; SDK signature tests cover raw-body tampering and stale signatures. These are not provider checkout/webhook acceptance tests. Before launch, verify all flows with real test credentials, test cards, CLI webhook redelivery, failure/recovery, cancellation, and portal configuration. Confirm billing mirrors cannot be written directly or granted through a forged success URL. Monitor reconciliation failures without logging raw payment/event payloads. Official references: [Stripe webhooks](https://docs.stripe.com/webhooks), [subscription objects](https://docs.stripe.com/api/subscriptions/object), and [Checkout](https://docs.stripe.com/api/checkout/sessions/create).

## Files, exports, and abandoned uploads

`pnpm test:access-security` provides connected invitation and public-review acceptance. It uses separate authenticated connections for invitation capacity, idempotent acceptance, revoke/accept, competing shop acceptance and onboarding races. Browser review actions check already-open forms after replacement/expiry/revocation, sent-file-only scope, parallel retries/competing decisions and read-only receipts. Synthetic expiry timestamps are advanced only on that run's fixtures. It preserves fixture records and writes safe pass metadata to `.local/access-security-check.json`; failure diagnostics stay ignored/local because browser URLs can contain bearer tokens. Scope `ALLOW_DEV_SEED=true` to the local check process. These checks do not replace HTTPS staging acceptance, provider delivery or a full external security review.

The private `order-files` bucket has no public read/write policies. Protected download routes proxy authorized bytes without signed URLs, so every new request checks membership or the current bearer link. Files already downloaded cannot be revoked from the recipient's device. Proxying bytes uses server resources; revisit streaming/provider limits before scaling beyond the initial file limits.

Uploads reserve quota before Storage writes, finalize their digest, and release known failures once. Server-only Supabase calls have a 30-second timeout. Reservations older than one hour cannot finalize; the maintenance worker retires them and releases quota atomically before object deletion. It leases at most 20 abandoned, unreferenced paths for two minutes, removes their bytes idempotently, and finalizes cleanup state. Ready files and all sent-proof references are excluded. Cleaned tombstones are rechecked daily for late-arriving orphan bytes. No routine cleanup deletes ready draft files because those may still be intentionally in use.

Run `pnpm files:clean` locally. In production, schedule hourly POST requests to `/api/internal/files` with the same server-only worker bearer secret. The preview deployment does this with Supabase `pg_cron` (see the email section). Failed deletion leaves the tombstone retryable; an interrupted job's lease expires. `pnpm test:files` passed against real Storage with parallel cleanup, expired/failed reservations, one-time quota release, late-orphan rechecks, immutable sent-file preservation, and competing reservations across different orders. Add provider/network failure rehearsal to production operational acceptance.

Shop logos use a separate private `shop-logos` bucket (PNG only, 1 MiB per object, no public or authenticated storage policies). The server sniffs content, requires matching type and extension, rejects SVG/PDF, decodes with a pixel limit, strips metadata, fits the image within 1024 pixels, and re-encodes it to PNG before upload. Only the owner of a writable shop can set or remove a logo. Logos do not count against the 2 GiB order-file allowance. `/api/logo` serves the current logo to signed-in members, or to the holder of an active, unexpired review link through the same review rate limit, with ETag revalidation. Each replacement or removal deletes exactly the object it displaced; a failed save deletes its staged object; a best-effort sweep on the next change removes leftovers older than one hour. Include `shop-logos` in binary backup inventories. `pnpm test:logo` verifies this against real Storage.

Owners can export `/api/export` as JSON with a member-authorized download manifest. Save the JSON and download every ready file separately. The manifest URLs require a current session; the JSON alone is not a binary backup. Exports page through records but are not yet a single transaction-consistent database snapshot.

## Workspace closure — concrete manual procedure

Self-service deletion is not implemented. Before launch, publish the actual founder support contact and verify owner identity through a signed-in owner session; do not accept an unauthenticated email as sufficient authorization. A founder handling closure must:

1. Confirm the authenticated owner, workspace ID, explicit deletion request, and awareness that cancellation alone does not delete data.
2. Provide an owner export and attachment-download window of seven calendar days; record the intended deletion time and confirmation outside customer-visible order history.
3. At the confirmed time, revoke public review requests, disable memberships, end the commercial subscription separately when implemented, and prevent additional work.
4. Using an explicitly reviewed maintenance transaction, remove files, dependent decisions/requests/production/collections/events/attachments/proofs/orders/customers, invitations/outbox/billing records when present, memberships, and the workspace. Delete the owner's auth identity only when it has no other membership. Verify no workspace blobs remain.
5. Record completion and explain how configured provider backup retention applies. A deletion maintenance script and rehearsal on staging are required before accepting closure requests.

This is a manual operating procedure; no automatic deletion is claimed. Production support details and the maintenance script remain launch tasks.

## Backups and restoration — not configured

No production database or file backup has been created. Select/configure actual Supabase backup/PITR availability and retention for the chosen plan. Database backups do not substitute for binary Storage backups. Keep encrypted independent database dumps and binary inventories/archives with tested access control and retention.

Restore rehearsal: restore a database backup into an isolated project; restore private bucket objects preserving object paths and digests; configure the isolated app; verify memberships, proof-file digests, decisions, counts, event chronology, and protected downloads; confirm billing/email are disabled during rehearsal. Document measured restore time and data loss window. Do not promise recovery objectives before this test.

## Logs and privacy

Do not log request bodies, tokens, personal notes, credentials, or full email payloads. Dev-server URLs can appear in framework request output, so use only synthetic review links locally. Before production, explicitly configure platform/proxy path redaction or disable review-path access logging, choose a concrete infrastructure-log retention period, review provider retention, and update the privacy draft. No analytics/third-party trackers are installed; UI fonts are bundled locally.
