# Production launch checklist

Unchecked items are unfinished or unverified. Do not treat the running demo as release acceptance.

## Implemented foundation

- [x] Responsive fictional demo, workflow walkthrough, landing and plan explanation.
- [x] Cookie-based Supabase auth integration and idempotent onboarding code.
- [x] Tenant-scoped schema/RLS, transactional domain functions, private bucket migration.
- [x] Intake/spec history, immutable proof snapshots, bounded public review access, production/pickup rules.
- [x] Protected file routes, decoded uploads, PDF/QR and structured owner export code.
- [x] Guarded local seed and second workspace.
- [x] Critical PostgreSQL-domain tests and browser-demo tests added.
- [x] Staff invitations, verified-email acceptance, seat reservation, revocation/removal implemented and SQL-tested.
- [x] Transactional outbox, secure leased worker, bounded retries, owner status, and local transport implemented and SQL/template-tested.
- [x] Stripe Checkout/Portal/webhook implementation, signed-body validation, owner authorization, checkout/reconciliation leases, and entitlement/grace tests.

## Required runtime acceptance

- [x] Docker/Supabase working, thirteen migrations applied, guarded seeds created, private bucket readiness verified.
- [x] Signup verification through actual local mail, recovery, logout protection, and idempotent onboarding.
- [x] Forced signed-token expiry/refresh across SSR/proxy and private Route Handlers, parallel refresh, invalid refresh and tampered-token denial verified locally.
- [x] Connected create/intake/reload/upload/version-1-changes/version-2-approval/production/pickup browser journey.
- [x] Crafted cross-tenant queries, RPCs, exports, PDFs, binary downloads, and Storage signing fail against Supabase.
- [x] Conflicting decisions tested through independent concurrent API clients; one durable outcome.
- [x] Revocation, expiry, replacement, public file scope and read-only same-link receipts verified through real endpoints/browser actions, including stale forms and concurrent decisions.
- [x] Parallel cross-order quota reservations, expired/failed reservation cleanup, late orphan rechecks, and sent-file preservation verified against Storage.
- [ ] Provider/network interruption rehearsal and production file-maintenance scheduler configured.
- [x] Real PDF content, no internal-note leakage, QR target, complete export and attachment round trip verified (`pnpm test:pdf`).
- [x] Full mobile keyboard/touch/empty/error/long-name/failed-save checks on real forms, not only demo (`pnpm test:forms`).

## Commercial operation

- [x] Actual invitation signup/mail verification, intended-email acceptance, owner-only team controls, and immediate removed-member private-file denial.
- [x] Invitation capacity, replacement/expiry/revocation, idempotent acceptance, acceptance/revocation races, cross-shop acceptance and onboarding races verified through independent real connections.
- [x] Customer contact/private-note editing, literal search, and directory/history pagination verified beyond 200 records, including concurrent edits and tenant/read-only permissions.
- [x] Active member assignment, reasoned/confirmed draft/open cancellation, pending review-link/file revocation, and completed/cancelled archive/restore verified, including independent races and mobile restoration.
- [x] Main order-directory connected browser acceptance finished with 600 current and 205 archived records: database search/paging, status/staff/archive filters, stable sorting, saved/shared views, detail return links, and mobile.
- [x] Shop logo upload/removal, private display and PDF branding connected-tested.
- [x] Stripe test price, hosted Checkout/Portal, signature checks, duplicate/out-of-order events, cancellation and grace/recovery verified (`pnpm test:stripe`).
- [x] No checkout success-URL entitlement bypass; owner-only billing enforced.
- [x] Parallel authenticated email workers verified against real Supabase/local files, with safe status and private-payload purging.
- [x] Actual email provider acceptance, refusal/retry, and crash/lease recovery without duplicates verified against Resend test mode.
- [ ] Production sender domain verified and production outbox scheduler configured.
- [x] Expired-trial UI/API behavior verified, including existing sent decisions, reads/exports, failed-input retention, and forged checkout-return denial.
- [x] Stripe-driven paid/grace expiry and recovery verified against actual test provider events (test clock renewal failure, retry, recovery, termination).

## Production configuration and founder decisions

- [ ] Final product name/domain chosen by founder; no availability or trademark claim made.
- [ ] Authorized production Supabase project, migrations, auth settings, SMTP, private Storage and limits.
- [ ] HTTPS `APP_URL`, redirect allowlists, host/proxy configuration, session-cookie and server-action checks.
- [ ] Stripe live setup explicitly authorized separately, only after complete test-mode acceptance.
- [ ] Sender domain and actual support/privacy contact; no invented addresses or operator details.
- [ ] Reviewed privacy/terms, infrastructure-log redaction/retention, provider data handling, support process.
- [x] Safe readiness probes for database, Auth, private bucket, and authentication-limit configuration/table access.
- [x] Leased abandoned-upload cleanup/recovery implemented and connected-tested.
- [x] Shared login/signup/recovery app attempt limits beyond provider limits, with parallel database and browser checks.
- [ ] Backups configured, binary exports secured, restore rehearsal completed and limitations documented.
- [ ] Owner-authorized closure maintenance tool implemented and rehearsed.
- [x] Production rejects all development-only flags/seeds; no universal credentials or secrets in build artifacts (`pnpm test:production`).
- [ ] Final typecheck/lint/unit/integration/browser/accessibility/build checks pass with actual services.
- [ ] Founder explicitly authorizes deployment and production launch. No deployment is authorized by this checklist.
