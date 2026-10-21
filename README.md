# StitchProof

Customer-supplied garment intake, proof approval, and pickup tracking for small embroidery shops. The original requirements remain in `StitchProof_Codex_SaaS_Build_Handoff.md`.

**Development checkpoint:** local Supabase is running with real Auth, PostgreSQL, and private Storage. The complete 24-polo browser workflow, signup/mail verification/recovery, team acceptance/removal, tenant isolation, exports/PDF downloads, and local email worker have passed connected checks. Stripe Checkout/Portal/webhook code is implemented and SQL/signature-tested, but actual Stripe test-account checkout and Resend delivery still need credentials and provider verification. Remaining launch gaps are tracked in `docs/BUILD_STATUS.md`; this is not a production release.

## Review locally

Requirements: Node 24 and pnpm 10.28.2 (exact package versions and lockfile included).

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

- App demo: http://127.0.0.1:3000/demo
- Landing/pricing: http://127.0.0.1:3000
- Full read-only tour: http://127.0.0.1:3000/demo/story
- Customer view: http://127.0.0.1:3000/demo/review
- Health/configuration status: http://127.0.0.1:3000/api/health
- Database/Auth/private-bucket readiness: http://127.0.0.1:3000/api/ready

Live preview: [landing page](https://stitchproof-g18oecwzx-bennettch1213-1215s-projects.vercel.app) · [read-only walkthrough](https://stitchproof-g18oecwzx-bennettch1213-1215s-projects.vercel.app/demo/story). It is hosted on Vercel and built from the public [GitHub repository](https://github.com/bennettc1213/stitchproof). No hosted Supabase project or production secrets are configured: the landing pages and synthetic, read-only demo work, but login/signup, persisted shop data, private storage, email delivery, and billing are not operational. Do not use this preview with real customer data or treat it as a production release.

For local development, the server binds to `127.0.0.1` only. Use that exact IPv4 address: this machine also has Quote Desk on IPv6 port 3000, so `localhost` may open the other app. Local auth redirects and checks use the explicit StitchProof address. Keep the terminal open, or use your IDE's persistent terminal. If port 3000 is occupied on IPv4, inspect the process rather than starting duplicate servers.

The public demo has synthetic, read-only fixtures. Filters and tour scenes change only the current view. It does not pretend to save data and cannot send email. Real shop routes never fall back to demo data. No authoritative order/auth/billing data is stored in localStorage.

## Connect the real local services

1. Start Docker Desktop with Linux containers. Docker Desktop 4.95.0 and WSL 2.7.13 are installed and working on this machine after its Windows restart. On another machine, install Docker/WSL first.
2. Start and apply pending migrations without deleting existing records:

```powershell
pnpm db:start
pnpm exec supabase migration up --local
pnpm db:configure
```

3. `db:configure` writes local connection keys to ignored `.env.local` without printing them, preserves unrelated settings, and rejects existing remote Supabase configuration. It defaults to local file email and generates worker and authentication-limit secrets. Keep `APP_URL=http://127.0.0.1:3000`; restart Next if it does not reload environment changes. For a hosted project, configure `.env.example` values manually with its authorized keys, including a random server-only `AUTH_RATE_LIMIT_SECRET` of at least 32 characters. Never commit keys.
4. Open `/signup`, verify through the local mail catcher at http://localhost:54324, and finish onboarding. Actual new shops start empty and receive a seven-day application trial without a payment card.
5. For a separate development shop, set `ALLOW_DEV_SEED=true` in `.env.local` and run:

```powershell
pnpm db:seed
```

The guarded script accepts only localhost Supabase, refuses production, and creates fictional development accounts. It generates a random password unless `DEV_SEED_PASSWORD` is set. Read the generated **ignored** `.local/seed-credentials.json` locally to log in at `/login`; do not publish that file. It includes `owner@cedar-stitch.example.test` and a second isolated owner. Re-running preserves existing seeded orders and rotates the account password to the configured/generated value. The seed is intentionally not automatically run by migrations.

Supabase Studio: http://localhost:54323. Local mail catcher: http://localhost:54324. Use a fresh terminal after Docker installation so its CLI is on PATH. The local config disables optional analytics/log collection that otherwise requires a Docker TCP endpoint on Windows; PostgreSQL order history is unaffected. The local mail-catcher limit supports the signup/recovery/invitation tests and is not a production SMTP setting. No hosted project is configured; local fixtures reject remote hosts.

Connected checks require `ALLOW_DEV_SEED=true` for the test process and loopback app/Supabase URLs. `test:connected` checks independent competing decisions, cross-shop queries/files/exports, staff removal, trial expiry, already-sent decisions, and forged checkout-return URLs. `test:workflow` exercises the entire 24-polo story using browser forms. `test:auth` exercises actual signup verification/recovery through the mail catcher and invitation signup/acceptance/removal. `test:email` runs parallel local workers and verifies file output/status/payload cleanup. All have passed; fixtures and reports are in ignored `.local/`. `test:workflow` requires the guarded seed first. Keep `ALLOW_DEV_SEED=false` outside explicitly guarded seed/check processes.

Production compilation with local email configured must disable that development transport for the build process, for example `$env:EMAIL_TRANSPORT='unconfigured'; pnpm build` in a temporary terminal. Production runtime deliberately rejects local email transport and development seeding. This compilation is not a production deployment.

## Authentication limits and session checks

Login, signup, and recovery server actions use shared PostgreSQL attempt counters with keyed email digests. Limits per normalized address are 10 logins/10 minutes, 3 signups/hour, and 3 recovery requests/15 minutes; per-action global ceilings are 300 logins/minute and 60 signup/recovery requests/minute. These are fixed windows; provider limits still protect direct Auth API calls. Missing secret/database guard fails closed. See [Operations](docs/OPERATIONS.md) for setup and limitations.

`pnpm test:auth-security` verifies parallel limits, browser denial/input retention, genuinely expired local ES256 tokens, SSR/API refresh, parallel refresh, and invalid-session denial. It requires the local Docker Auth container and explicit fixture guard; no signing keys, passwords, or session values enter its report `.local/auth-security-check.json`.

## Team and transactional email

`pnpm test:access-security` runs guarded local adversarial acceptance against real Auth/PostgREST connections, Storage and browser actions. It checks invitation seat/acceptance/revocation/onboarding races, expired/replaced/wrong-account links, public proof-file scope, stale review submissions, concurrent decisions and read-only receipts. Only isolated fictional fixtures are modified; the safe report is `.local/access-security-check.json`. It requires the running local app/Supabase and `ALLOW_DEV_SEED=true` for that process. It never sends provider email.

Owners create/revoke invitations and remove staff under **Settings → Team**. Seven-day invitations reserve one of two staff seats and require the intended verified email. Login/signup preserve the invitation destination. Accounts with an existing workspace cannot join another shop. Removal revokes subsequent reads, mutations, and private downloads; already downloaded files cannot be recalled.

Review/invitation forms offer an explicit email checkbox; ready orders offer a pickup notice. Recent email states and owner-only retries appear under **Settings → Shop profile**. Delivery happens only when the worker runs.

For safe local testing, set `EMAIL_TRANSPORT=local` and a random `OUTBOX_WORKER_SECRET` of at least 32 characters in `.env.local`, restart the app, and run `pnpm email:work`. Up to five messages are written to ignored `.local/outbox/<id>.json`, with state **development outbox**, never delivered. This transport requires loopback Supabase and is rejected in production. Local files contain private links; keep them local and remove them after testing.

Actual delivery requires `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY`, and a verified address in `EMAIL_FROM`. Schedule a POST to `/api/internal/outbox` with `Authorization: Bearer <OUTBOX_WORKER_SECRET>` every minute. Durable leases and provider idempotency protect retries; attempts stop after six failures or a 23-hour window. Provider acceptance is not claimed as delivery. No sender, scheduler, or actual Resend delivery is configured/verified. See [Operations](docs/OPERATIONS.md).

## Stripe configuration

The integration uses pinned Stripe SDK 23.0.0 / API `2026-09-30.endive`. Set `STRIPE_MODE=test`, a test `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, a fixed $39 USD monthly licensed `STRIPE_PRICE_ID`, and `STRIPE_PORTAL_CONFIGURATION_ID`. Enable card payments; the portal must allow cancellation at period end and disable subscription plan changes. Do not add a Stripe trial: the app trial is seven days without a card, and checkout starts payment immediately.

Forward snapshot test events with the Stripe CLI to `/api/stripe/webhook`: checkout completion, subscription creation/update/deletion, invoice paid/payment success/failure. Owners alone can create/reuse checkout, manage billing, or refresh status. Server-controlled customer associations, checkout leases, stable idempotency keys, fresh provider reconciliation, event deduplication, and persisted three-day failure grace protect entitlement state. Returning from checkout never grants access by itself. Development rejects live keys; production live mode additionally requires `STRIPE_ALLOW_LIVE=true`. No account, price, paid session, or live charge has been created by this build. Actual test-provider acceptance remains unverified.

## Commands

| Command                                 | Purpose                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm dev`                              | Loopback-only development server                                                      |
| `pnpm typecheck`                        | Strict TypeScript checks                                                              |
| `pnpm lint`                             | Next/React/TypeScript ESLint checks                                                   |
| `pnpm test`                             | PostgreSQL domain/RLS, uploads, and PDF checks                                        |
| `pnpm exec playwright install chromium` | One-time local test browser install                                                   |
| `pnpm test:e2e`                         | Desktop and mobile demo/accessibility checks; server must already run on port 3000    |
| `pnpm build`                            | Production compilation (not deployment)                                               |
| `pnpm start`                            | Loopback production server after build                                                |
| `pnpm db:start`                         | Start Docker-backed local Supabase                                                    |
| `pnpm db:reset`                         | Reset **local** database and apply committed migrations; destroys local database data |
| `pnpm db:seed`                          | Explicitly guarded fictional development shops                                        |
| `node scripts/capture-proof.mjs`        | Rebuild fictional code-rendered PNG proof fixtures from running demo                  |

Additional commands: `pnpm db:configure`, `pnpm test:connected`, `pnpm test:workflow`, `pnpm test:auth`, `pnpm test:email`, `pnpm test:files`, `pnpm test:customers`, `pnpm test:controls`, `pnpm test:orders`, `pnpm email:work`, and `pnpm files:clean`. Service checks load `.env.local`; mutation checks require the explicit development guard. `email:work` processes at most five queued messages per invocation.

## Order search and saved views

The real order list searches every current or archived shop order by title, customer name/company/email, or order number (including `#1001`). Status and assignment filters, newest/oldest and ascending/descending due-date sorting, and 24-record pages run in PostgreSQL. Undated orders appear last in both due-date sorts. Summary cards reflect the full search/assignment/view scope, independent of the selected status or displayed page. Size discrepancies are detected per size even when total quantities happen to match.

Use **Apply filters**, the status tabs, and **Current orders / Archived orders**. Filters and page position are stored in the URL; opening a row and using **All orders** returns to that view. Shared URLs still require shop membership. Former-member assignment links remain usable for historical work, and read-only shops retain full browsing. Search treats punctuation literally. The public demo keeps its synthetic in-memory filters.

`pnpm test:orders` checks 600 current and 205 archived fictional orders through actual Supabase and browser pages, including stable sorting, counts, saved/shared/reloaded views, back/forward navigation, detail return links, mobile search/paging, and isolation. Reports/screenshots are ignored under `.local/`.

## Order controls

Open an order's **Order controls** panel to assign an active member or leave it unassigned. Owner and staff can assign active work; assignment preserves approvals and records its history. A removed member remains identifiable as a former team member, without retaining access or appearing as a current choice.

Draft/open orders can be cancelled with a reason and explicit confirmation. Pending review links and their public file access become inactive immediately. Files, approvals, and history remain; production cannot be reversed with cancellation. Collected/cancelled orders can be archived and restored using **Current orders / Archived orders**. Restoring visibility preserves the terminal status. Private downloads, PDFs, customer history, and exports remain available while archived. Both list views use complete database-backed pagination.

`pnpm test:controls` uses isolated local fixtures to verify owner/staff assignment, cancellation input/conflicts, pending link/file revocation, production/cancellation and staff-removal races, archive visibility, retained records, read-only permissions, and desktop/mobile restoration. Its report is ignored `.local/order-controls-check.json`.

## Customer management

Open **Customers** to search by name, company, email, or phone and browse 24 records per page. Open a customer to edit contact details/private notes and browse their complete paged order history. Owner and staff edits require active entitlement and an expected revision; conflicts and duplicate emails preserve unsaved input. A contact edit never sends email or rewrites sent proof/decision records or queued recipients. Read-only shops retain customer/history access. Customer and order directories/history use database-backed pages.

`pnpm test:customers` uses an explicitly guarded local synthetic workspace with 206 customers and 205 orders. It checks real database paging/search, concurrent edits, browser saves/conflicts/duplicate emails, old-record lookup, shop isolation, read-only/removed-member access, and proof/queued-recipient preservation. Its report is ignored `.local/customers-check.json`.

File maintenance uses the same worker secret to POST `/api/internal/files`; run `pnpm files:clean` locally and schedule hourly in production. It expires reservations after one hour, releases quota once, and removes only abandoned, unreferenced object paths through leased jobs. Ready files and sent-proof references are preserved. Daily tombstone rechecks catch late orphan writes. `pnpm test:files` passed actual Storage deletion, quota release, late-orphan cleanup, sent-file preservation, and competing quota reservations across different orders. Jobs are implemented; no production scheduler is provisioned.

Database tests use PGlite only as an isolated PostgreSQL test engine with test auth stubs. The application does not use it. These tests are useful SQL/authorization evidence and do not replace Supabase Auth/Storage integration or multi-connection race tests.

## Architecture and assumptions

- Next.js 16 App Router, React 19, TypeScript, Lucide icons, custom accessible CSS; self-hosted DM Sans and Manrope. Shared renameable identity lives in `src/lib/brand.ts`.
- Supabase SSR clients use cookies and the Next proxy refreshes validated auth claims. User-scoped SELECT queries rely on RLS. Every domain write uses a transaction-scoped SQL RPC with membership/entitlement/precondition checks. Direct authenticated table writes are revoked.
- One workspace per user, with explicit memberships. Owner-managed invitations bind to verified email, reserve staff seats, and serialize acceptance with onboarding. Invitation creation is rate limited in PostgreSQL.
- Garment groups, sizes, and decoration specs use validated JSONB inside the order row. This is an intentional schema simplification: the complete intake is versioned atomically and copied to immutable proof/production snapshots. Relational workspace/customer/file constraints remain in SQL.
- Proof drafts are unlinked uploaded files. Sending creates the immutable numbered bundle and its current review request atomically. No sent bundle can be edited via application permissions.
- Server routes validate file bytes, MIME/extension, image decoding and quotas. Images are re-encoded with EXIF removed. PDFs must parse, are limited to 100 pages, and are delivered by a protected route rather than injected HTML.
- No browser/client service-role usage. The server-only service client is restricted to narrow public review RPCs, authorization-checked private files, and the secret-protected worker. Authorization stores token digests. Optional queued emails temporarily retain plaintext tokens in server-only payloads until acceptance/local write or worker cancellation/expiry. Exports, team summaries, and general events never contain these tokens.
- Public origin comes from validated `APP_URL`; links never use an untrusted Host header. Review pages use no-store/noindex/no-referrer and self-hosted assets. Public link/file access consumes shared database minute counters.
- Seven-day app-managed trial gates writes. Expired workspaces retain SELECT/export/billing access, and already-sent reviews remain actionable until expiry. Stripe reconciliation mirrors confirmed paid-through time and a persisted three-day payment-failure grace; its SQL rules are tested but actual provider checkout/webhooks remain to verify.
- `pdf-lib` + embedded OFL Noto Sans generate multi-page PDFs; `qrcode` uses the authenticated order URL. Internal notes are excluded from PDFs/review pages. Owner exports include internal records and a separate authenticated binary-download manifest.
- Opening records and seeding never dispatch email. Review/invitation messages require an explicit checkbox; decisions queue owner notifications; pickup notices require a staff action. The worker performs delivery and records safe status history. No billing fixture grants production access.

Implementation follows the official [Next App Router guidance](https://nextjs.org/docs/app/getting-started/installation), [Supabase cookie-based SSR guidance](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [local development guidance](https://supabase.com/docs/guides/local-development/cli/getting-started), and [private Storage access guidance](https://supabase.com/docs/guides/storage/security/access-control). Font licenses are distributed with the font packages and `public/fonts/OFL.txt`.

## Delivery documents

- [Build status and three-phase schedule](docs/BUILD_STATUS.md)
- [UI makeover and reference notes](docs/UI_MAKEOVER.md)
- [Product rules](docs/PRODUCT_RULES.md)
- [Operations and recovery](docs/OPERATIONS.md)
- [Production launch checklist](docs/LAUNCH_CHECKLIST.md)
- [Founder walkthrough](docs/FIRST_CUSTOMER_WALKTHROUGH.md)

See those documents for verified checks, exact remaining work, service requirements, and release blockers. No production infrastructure, live charges, outbound outreach, or deployment has been created.
