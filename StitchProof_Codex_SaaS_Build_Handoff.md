# StitchProof — Complete Codex SaaS Build Handoff

**Prepared:** October 19, 2026  
**Working product name:** StitchProof  
**Product:** Customer supplied garment intake, proof approval, and pickup tracking for small embroidery shops.  
**Commercial starting point:** One plan at $39 USD/month per shop.  
**Primary objective:** Build a usable, focused SaaS that its founder can demonstrate to a shop owner and use to onboard a first paying customer. A customer within 24 hours is a sales target, not a promised outcome.

---

## 1. Your assignment as the coding agent

Build the actual application described in this document. Deliver the marketing website, authenticated shop application, customer approval experience, persistence, subscription integration, tests, and operating documentation.

Do not stop after a design, landing page, scaffold, component gallery, or simulated dashboard. Start implementing after a short repository inspection. Make routine product and engineering decisions yourself and record material assumptions in the README. Ask only for information that truly blocks an authorized action. Continue independent work when an external credential is missing.

The founder will use a coding agent to develop this product and wants to move quickly. Complete the core order-to-approval-to-pickup workflow before expanding other features. A polished interface is necessary; functional correctness and customer data isolation are release requirements.

At the end, start a persistent development server using the environment's supported background process mechanism and provide the exact localhost URL and any available preview URL. Verify that the running app responds before reporting success. Include local demo access instructions, test results, remaining configuration, and honest limitations. Do not expose the development server publicly or deploy a paid production environment without an explicit instruction to do so.

StitchProof is a provisional name. Do not claim that a domain or trademark is available, buy a domain, or register a company. Keep branding easy to rename through a shared configuration file.

## 2. Product judgment and market context

The initial buyer is an owner operated embroidery or custom apparel shop accepting clothing its customers supply. The initial buyer often has a small team and coordinates some orders through email, messages, paper, or basic forms. This is a customer hypothesis to validate, not a verified description of every shop.

The job to be done is:

> Keep the garments we received, the instructions we recorded, and the design the customer approved together, so the next employee can complete the right order.

The commercial opening is a focused workflow that a shop can adopt alongside its existing invoicing or accounting system. Do not require migrating the shop's entire business.

Research found existing competitors and established workflows. Do not describe this as an empty market or invent willingness-to-pay evidence. Relevant source material, checked during the planning conversation:

| Source | What it establishes | Product implication |
| --- | --- | --- |
| https://www.koalateesinc.com/wholesale | A Utah decorator requests garment specifications, quantities, size breakdowns, decoration locations, and approval before production. | Support structured intake and a clear proof approval record. |
| https://www.urban-imprints.com/general-9 | A shop publishes a customer supplied item order and acknowledgment workflow. | Allow a shop's own policy to accompany the order. |
| https://www.printavo.com/pricing/ | Printavo offers broader shop management and artwork approvals; its Lite plan listed $109/month when checked. | Compete through focused adoption and workflow quality; do not claim approvals are unique. |

Competitor prices can change. These are research notes, not website marketing claims. Do not copy competitors' branding, layouts, policies, customer lists, or screenshots.

### The demonstration story

Use a clearly fictional shop named **Cedar Stitch Demo** and this fictional order:

1. A customer expects to deliver 24 company polos: 6 small, 8 medium, 6 large, and 4 extra large.
2. The shop initially receives 23 because one medium is missing.
3. The employee photographs the garments and records the discrepancy.
4. The customer delivers the missing polo. The shop records the correction, preserving the earlier count in history.
5. The shop sends proof version 1 showing the logo placement.
6. The customer requests a smaller logo.
7. The shop uploads version 2 and sends a new request.
8. The customer reviews version 2, the garment summary, and the shop policy; enters their name and approves.
9. Production can begin against that exact approved snapshot.
10. The employee records 24 completed garments, marks the order ready for pickup, and records collection.

This entire journey must work with real local persistence and refresh correctly. Demo accounts and data must be visibly labeled and separate from actual shop workspaces.

## 3. Scope and release priorities

### Required for the first sellable release

- Responsive public landing page, pricing section, and interactive demo entry.
- Owner signup, email verification, login, password reset, and shop onboarding.
- A workspace per shop, with one owner and up to two additional staff members.
- Customer records and searchable orders.
- Structured garment intake, count reconciliation, condition photos, and decoration instructions.
- Proof uploads and immutable numbered proof versions.
- Secure customer review links with approve/request-changes actions.
- Production and pickup states with server-enforced transition rules.
- Printable order sheets, QR codes, and downloadable PDF records.
- Order history with meaningful events.
- Shop branding, timezone, policy text, and email settings/status.
- A single subscription plan using hosted checkout and a billing portal.
- Data export, clear empty states, accessible forms, and useful error handling.
- Genuine tenant isolation, protected file storage, and critical workflow tests.

### Deliberately outside this release

Machine embroidery file creation or preview, automatic digitizing, AI design generation, supplier catalogs, garment purchasing, inventory purchasing, accounting synchronization, native mobile apps, customer order payments, production machine integrations, route planning, SMS, social posting, advanced analytics, multiple pricing tiers, and an AI chat assistant.

The subscription pays for StitchProof. Customer payments to the embroidery shop remain outside the app. Do not confuse these two payment flows.

Do not add features outside this scope because there is spare UI space. All primary buttons must perform a useful action; remove unfinished controls.

## 4. Technology and local development

If entering an existing repository, inspect its README and applicable AGENTS.md files first. Preserve a viable existing stack. If starting from an empty repository, use this default architecture:

- Next.js App Router, React, and TypeScript.
- Tailwind CSS with a restrained accessible component library such as shadcn/ui.
- Supabase Postgres, Auth, and private Storage, using the supported server-side session integration.
- Zod or an equivalent shared server validation library.
- Stripe hosted Checkout and Customer Portal for the SaaS subscription.
- Resend or an equivalent transactional email provider behind a small email adapter.
- A maintained PDF library for server generated PDFs and a maintained QR library.
- Playwright for critical browser flows, plus a lightweight unit/integration test runner.
- pnpm with a committed lockfile, unless the repository has a different package manager.

Check current official documentation before implementing framework-, authentication-, storage-, email-, or payment-specific APIs. Use compatible maintained versions and pin them. Do not trust API examples in this handoff as version-specific documentation.

Prefer Supabase's local stack for development so the same database, auth, and storage semantics work locally and in production. Provide migrations, local service configuration, development-only seeds, and exact startup commands. Use the local mail catcher supported by that stack where available.

Do not silently replace persistent data with localStorage, hardcoded arrays, or a separate fake backend. If Docker or the required local service cannot run, make the UI reviewable with clearly labeled sample data, complete the real integration code, and precisely report the blocked database-backed checks. Never claim that the SaaS is fully operational in that situation.

Missing Stripe credentials must not block the order workflow. Expose billing as unconfigured in local development and provide a development-only entitlement fixture. Missing email credentials should produce a real development outbox/mail-catcher entry, never a fake “email sent” success. These development facilities must be impossible to enable accidentally in production.

### Environment configuration

Supply a commented `.env.example` with the actual variable names used by your implementation. Cover app URL, Supabase public URL/key and any necessary server-only secrets, Stripe secret and webhook keys, Stripe price ID, email provider configuration, sender address, and local development flags.

Public application origin must come from validated configuration. Never construct an approval link from an untrusted request Host header. Never commit real secrets or print them in logs or the final response.

## 5. Visual direction

Design for a busy shop owner using a laptop at the counter and an employee using a phone beside a worktable.

- Warm off-white backgrounds, charcoal text, restrained forest green accents, and muted borders.
- Clear modern typography, generous form spacing, and compact, legible data tables.
- Status indicators with text and icons, not color alone.
- Order lists with useful columns rather than oversized metric cards.
- One clear primary action per screen or section.
- Calm customer approval pages with large proof previews and obvious decisions.
- A restrained thread or stitch mark may serve as the logo; implement it as SVG/CSS. Avoid decorative AI imagery.
- No space themes, robot mascots, glowing gradients, excessive glass effects, or invented testimonials.

Use an accessible light theme for this release. Support approximately 390px mobile, 768px tablet, and 1440px desktop widths. Mobile order details should have a convenient primary-action area without covering content. Touch targets should be comfortably usable; respect reduced motion and visible keyboard focus.

### Landing page

Lead with a concrete promise such as: **“Every garment. The right proof. One clear order.”** Explain intake, approval, and pickup using real UI examples. Provide “Start your shop” and “Explore demo” actions. Show the $39/month plan, three team members total, and the seven-day trial described below.

Use an actual working product screenshot only after the app exists, or use accessible UI components representing the workflow. No fake customer logos, conversion statistics, reviews, “trusted by” counts, compliance certifications, or revenue claims.

Production privacy and terms pages must reflect implemented behavior and contain no invented legal entity, mailing address, or support address. Supply editable drafts, mark them for founder review in the launch documentation, and treat missing business details as a production launch task.

## 6. Pages and navigation

| Route family | Purpose |
| --- | --- |
| `/` and `/pricing` | Marketing and the single plan; pricing may reuse the landing section. |
| `/login`, `/signup`, `/forgot-password`, `/reset-password` | Real authentication. |
| `/onboarding` | Shop name, timezone, optional logo, and initial policy. |
| `/app/orders` | Default signed-in destination; search, filters, and order creation. |
| `/app/orders/new` | Customer selection and initial job setup. |
| `/app/orders/[id]` | Intake, proofs, production, pickup, files, and history. |
| `/app/customers` and `/app/customers/[id]` | Customer details and past orders. |
| `/app/settings/shop` | Brand, timezone, shop policy, and contact details. |
| `/app/settings/team` | Owner-managed invitations and membership. |
| `/app/settings/billing` | Plan status, checkout, invoices/portal, and access state. |
| `/app/settings/data` | Owner exports and workspace closure request/process. |
| `/review/[token]` | Narrow customer approval portal with no account required. |
| `/demo` | Clearly labeled fictional, read-only product tour. |

Equivalent routes are fine if the repository has established conventions. Signed-in staff should never see another shop through a changed URL, search result, export, QR code, or attachment request.

## 7. Authentication, memberships, and onboarding

Owners sign up with email/password. Use the auth provider for email verification, password hashing, recovery, and sessions; do not build a custom password system. In production, verify an owner before they can invite staff or send customer approval emails. Session refresh and logout must work correctly with server-rendered routes.

Create the owner, workspace, membership, and trial state safely. Onboarding must be idempotent: refreshes or retries cannot create duplicate workspaces or memberships. Use server-side transactions/database functions where needed.

Roles are **owner** and **staff**:

- Owner: all job operations plus team management, billing, shop policy changes, bulk export, and workspace closure.
- Staff: customer and job operations, uploads, approval requests, production, pickup, individual order PDFs, and history.
- Neither role may edit or delete an approval decision or rewrite recorded history through the application.

Invitations use expiring single-use tokens, are tied to the intended email, and require authentication as that email. An owner can revoke an invitation or remove a staff member. Removal immediately removes access; enforce membership in database authorization instead of relying only on stale role claims in a cookie.

Prevent removal of the last owner. Owner transfer and multiple-owner administration are outside this release. Support one workspace per new owner initially, but model membership explicitly rather than scattering assumptions throughout the app.

## 8. Customer and order records

### Customer

Store name, optional company, email, optional phone, and internal notes. Require a valid email before sending a review request. Phone is for contact information only in this release. Do not send texts.

Keep public/customer-visible notes separate from internal notes. Mark both clearly in the interface. When creating an order, search existing customers and warn about an existing matching email rather than silently creating duplicates.

### Order header

Include workspace, human-readable order number, customer, short job title, due date, assigned staff, internal notes, customer-visible instructions, created/updated timestamps, and lifecycle state. Order numbers must be unique within a workspace under concurrent creation. Use a database sequence/counter strategy, not an unsafe “read maximum then add one.”

Due dates may be date-only values. Record event timestamps in UTC and display them in the shop's selected IANA timezone. Do not shift a date-only due date when converting timezones.

### Garment intake

An order has one or more garment groups, each with item description, optional brand/style, color, material notes, and size rows. Each size row stores expected and received counts as nonnegative integers. Support common sizes and custom labels such as youth sizes, one-size, or numeric sizes.

Show expected total, received total, and per-row differences. Reject negative counts, fractional counts, impossible totals, and duplicate submissions. Save intake changes as meaningful history events including old/new values and actor.

Photographs can document an individual garment group or the order overall. Allow captions for condition notes such as stains, holes, or pre-existing embroidery. Do not present an upload timestamp as proof of when a photograph was originally taken.

Mismatch handling: allow draft intake with a discrepancy, but require reconciliation before sending the final production approval. Resolve by updating the expected/received count with a recorded reason. This version has no undocumented “ignore discrepancy” override.

### Decoration instructions

Record placement, logo/design name, dimensions and units, thread/color notes, and any exact embroidered text. Do not pretend to calculate stitch counts or assess whether a design is technically embroiderable. Shops supply production judgment.

## 9. Proof versions and the approval contract

This is the core product. Treat approval as a database-backed decision about a specific immutable snapshot, not a green badge that can be toggled by an employee.

### Proof bundle

Each numbered proof version may contain one or more ordered images/PDFs to represent multiple placements. It also contains a server-created snapshot of customer-visible instructions, relevant garment descriptions and counts, exact text, decoration specifications, shop policy text/version, and order identifier.

The shop reviews the bundle and explicitly sends it. Uploaded but unsent versions are drafts. Once sent, the proof bundle's files and snapshot must not change. Corrections create a new version. Store immutable file references/digests sufficient to identify the reviewed artifacts. Never overwrite a blob already referenced by a sent or approved bundle.

Only one current review request may be actionable for an order. Sending a replacement version revokes previous outstanding review links. Preserve old versions and their actual outcomes for the shop.

### Customer review experience

Show the shop identity, job title/number, due date, garment summary, all proof pages/files, exact text/specifications, and the policy snapshot. Never reveal staff-only notes, other customers, billing information, or the shop's whole order list.

Provide two clear actions:

1. **Approve this proof:** require the customer's typed name, an explicit confirmation of the displayed design/instructions and quantities, and a separate acknowledgment of the displayed shop policy. Store the actual text of these confirmations.
2. **Request changes:** require a plain-text explanation. Capture it against this version and notify/show it to the shop.

Do not pre-check acknowledgment boxes. Keep input errors clear. Customer attachments to change requests are deferred; text is sufficient for version one.

The link is a bearer link: possession allows review. It is not verified identity or a guarantee of legal enforceability. Do not advertise a typed acknowledgment as a certified digital signature or claim that the app eliminates shop liability. Let shops provide their own policy; never auto-generate legal promises.

### Token and concurrency requirements

- Generate high-entropy cryptographically random tokens, at least 256 bits. Store only a digest for token lookup, with expiry, revocation, and request relationship.
- Default review expiry: seven days. Provide owner/staff controls to resend with rotation or revoke.
- Generate a usable link at send time. Do not store plaintext bearer tokens in logs, general event metadata, analytics, or client-readable tables.
- If email retries require the link, keep the outbound payload server-only with bounded retention; purge the secret payload on successful delivery or expiry. A resend creates a fresh request/token.
- Put no email address or other customer personal information into the URL.
- Approval/request-changes is an explicit POST action protected against duplicate submission; link previews and GET requests must never change state.
- Atomically verify the token, expiry, current version, job state, and undecided request before recording a decision and event.
- Concurrent conflicting decisions must produce one durable outcome. Duplicate identical submissions may return that same outcome safely.
- Recheck state on submission. A page left open for an old version must not approve a new version or restore an old one.
- After a decision, the same unexpired, unrevoked link may show a limited receipt, but cannot change the decision. Expired/revoked links show a generic inactive message and a contact-shop action.
- Rate-limit invalid lookups and submissions. Use `noindex`, `Cache-Control: no-store`, and a restrictive referrer policy; avoid third-party tracking on review pages.

Customer file access must be limited to the bundle associated with the token. Any short-lived storage URL is scoped to those files and lasts only briefly. Revocation must block new URL issuance; document that an already-issued URL remains usable until its short expiry.

## 10. State model and production rules

Separate the job lifecycle from approval status to avoid confusing combinations.

**Lifecycle:** `draft` → `open` → `in_production` → `ready_for_pickup` → `completed`. `draft` or `open` may become `cancelled`. Archiving is a visibility field allowed for completed/cancelled jobs, not a substitute for their state.

**Approval status:** derive `not_requested`, `pending`, `changes_requested`, `approved`, or `invalidated` from version and decision records. Do not maintain an unrelated mutable approval boolean.

| Action | Server preconditions | Result |
| --- | --- | --- |
| Open order | Customer and at least one garment group exist. | Lifecycle becomes open. |
| Send proof | Open order; received counts reconcile; customer email exists; valid proof bundle. | New actionable review request; approval pending. |
| Request changes | Current actionable review request. | Decision recorded; approval changes requested. |
| Approve | Current actionable request; confirmations and name supplied. | Approval recorded for exact snapshot. |
| Start production | Open order; approval is current and valid; counts reconcile. | Save production snapshot; lifecycle in production. |
| Ready for pickup | In production; completed and exception quantities account for received garments. | Lifecycle ready for pickup. |
| Record collection | Ready for pickup; collector name and confirmation supplied. | Lifecycle completed; collection timestamp and staff actor recorded. |

If counts, specifications, exact text, policy, or proof files change after approval but before production, invalidate readiness, preserve the old approval, and require a fresh version/approval. Internal notes, assignment, and purely internal due-date adjustments do not change the approved production specification.

Block customer-visible production-specification edits after production starts in this release. Explain the restriction in the UI. Do not permit accidental changes to the approved production snapshot. A full pause/rework/change-order workflow is deferred; record exceptions and coordinate any new work as a separate order.

For each garment group, capture completed quantity and exception quantity with a required reason for exceptions. Prevent totals above received quantities. To mark ready, completed plus exceptions must equal received. An exception does not silently promise the customer a replacement or refund. Do not conflate completed garment quantity with collected order status.

Collect the entire order at once for the first release. Partial pickup, partial production approvals, and multiple concurrent proof requests per order are outside scope. Cancellation after production begins requires a future explicit workflow; do not enable an ambiguous shortcut now.

Enforce all rules on the server/database boundary. Hidden or disabled buttons are only a usability layer.

## 11. Database model

Produce committed SQL migrations with foreign keys, indexes, checks, row-level security policies, and safe transactional functions where needed. Suggested entities:

| Entity | Required purpose |
| --- | --- |
| `workspaces` | Shop identity, timezone, branding, trial dates, policy version. |
| `memberships` | Auth user, workspace, role; unique membership. |
| `invitations` | Intended email, role, hashed token, expiry/revocation/acceptance. |
| `customers` | Shop-scoped customer details and internal notes. |
| `orders` | Workspace/customer, number, lifecycle, assignment, due date, archive flag. |
| `garment_groups` / `garment_sizes` | Structured item details, expected and received quantities. |
| `decoration_specs` | Order/group placement and exact production instructions. |
| `attachments` | Workspace/order, storage path, MIME type, bytes, digest, purpose, caption. |
| `proof_versions` / `proof_version_files` | Unique order/version, immutable snapshot and ordered files. |
| `review_requests` | Version, token digest, expiry, revocation and terminal outcome. |
| `approval_decisions` | Version/request, choice, name/comments, confirmations, timestamps. |
| `production_runs` / `production_counts` | Approved snapshot and completed/exception quantities. |
| `collections` | Order, collector name, staff actor, collection timestamp. |
| `order_events` | Append-only application history with actor and safe event metadata. |
| `email_outbox` | Recipient, template, delivery state, attempts, and provider reference. |
| `subscriptions` / `billing_events` | Server-controlled entitlement mirror and webhook idempotency. |

Denormalize only when it protects an immutable historical snapshot or materially simplifies a query. Use database constraints, not only form validation. Ensure relationships cannot connect an order in one workspace to a customer, attachment, proof, or member in another; composite constraints or equivalently robust checks are appropriate.

RLS must cover all shop data and storage access. An authenticated user can only access rows for an active membership, with owner-only restrictions for administration. Sensitive token tables, email payloads, and billing records should not become broadly readable just because a user has workspace membership. Public customers do not get anonymous SQL access to the order tables.

Use a narrow server endpoint/database function for public decisions; revalidate all conditions atomically. Service-role credentials bypass RLS, so any use must be server-only with explicit authorization and minimal scope. Prefer user-scoped queries for authenticated shop operations. Avoid recursive membership policies.

Audit history is append-only through app permissions, not an immutable ledger against the database owner. Do not claim tamper-proof records. Define deletion/closure procedures that deliberately remove personal data without silently rewriting active order history.

## 12. Uploads, exports, and PDFs

- Private buckets only. Use non-guessable object names scoped to workspace/order.
- Accept JPEG, PNG, WebP, and PDF for proofs; images for condition photographs. Set a 10 MiB per-file limit initially and a configurable 2 GiB per-workspace storage allowance.
- Validate authorization, size, extension, detected file type, and MIME consistency server-side. Reject SVG, HTML, scripts, archives, executable files, and arbitrary URLs as uploads.
- Do not fetch arbitrary user supplied URLs. Use genuine file uploads.
- Render PDFs through a safe viewer or download path. Do not inject untrusted SVG/HTML into pages. Protect authenticated previews and strip unnecessary image metadata where practical.
- Enforce storage quota atomically during upload reservation/finalization so simultaneous uploads cannot bypass it. Release abandoned reservations and clean orphan uploads safely.
- Remove temporary/orphan files, but never automatically delete sent proof files referenced by active historical records.

**Order sheet:** shop name/logo, order number, customer, due date, garment breakdown, key instructions, approval status/version, and a QR code pointing to the authenticated order URL. This QR must not contain a customer approval token or bypass staff login.

**Approval record PDF:** proof version, relevant preview/file references, approved snapshot, decision details and confirmation text. Do not label it approved when the decision is pending or changes requested. PDF generation is server-side and authorization checked; do not leak internal notes into customer-facing exports.

**Owner export:** customers, orders, garment counts, approval metadata, and history as structured CSV/JSON. Escape spreadsheet formula-leading values in CSV exports. Clearly explain how binary attachments are exported/downloaded separately; do not imply a CSV contains the actual proof files. Include a tested owner-authorized attachment export path or manifest with freshly generated authorized downloads.

## 13. Email and notification delivery

Build transactional templates for account/invitation flows, proof review requests, change/approval notifications to the shop, and ready-for-pickup notices. Do not send marketing campaigns or cold outreach from this app.

Persist a domain action and its outbox event together. An email provider failure must not lose an approval decision or incorrectly mark a message delivered. Track queued, accepted-by-provider, delivered when genuinely known, and failed states separately.

Provide bounded retries with backoff and an idempotency/deduplication strategy. Supply a secure outbox worker route/job or a documented worker process and local command. Do not depend on request-time fire-and-forget work that may die when a serverless request ends. Protect scheduler invocation; authenticate notification webhooks if implemented.

Use owner/staff actions to initiate order emails; do not automatically send a real customer a message merely because someone opened an order. Log transactional email status in order history without exposing secrets. Development seeds must never send to real recipients.

If sender setup is incomplete, show an actionable configuration status. Permit an authorized employee to create and copy a review link even when email is unavailable, with accurate “link created” language. Copying is a deliberate user action, not proof of email delivery.

## 14. Subscription and entitlement model

One plan: **$39 USD/month per workspace**, one owner plus two staff, core workflow included, with the disclosed 2 GiB storage allowance. No invented “unlimited” claim that contradicts limits.

Use a **seven-day app-managed trial** beginning at workspace creation, without a card. Do not create a conflicting Stripe trial. “Subscribe now” clearly starts the paid subscription immediately when the customer completes checkout; communicate that the charge is immediate and the unused app trial does not delay it.

- Only the owner may create checkout sessions or open the billing portal.
- Resolve the allowed price server-side. Ignore client-supplied amounts, price IDs, workspace IDs, or success entitlements.
- Associate Stripe customer/subscription with the workspace using trusted server data and validated metadata.
- Verify webhook signatures using the raw request body. Deduplicate events and handle out-of-order delivery by reconciling current provider state when needed.
- Grant paid entitlement after verified server-side reconciliation, not because a browser reached the success URL.
- Verify checkout completion, invoice success/failure, subscription updates, and deletion as appropriate to the current API.
- Prevent duplicate active subscriptions from repeated checkout clicks; reuse/reconcile incomplete sessions as appropriate.
- Support billing portal cancellation at period end and display the actual paid-through date.
- For payment failure, provide a documented three-day application grace period, measured from a reliable persisted failure state; payment recovery clears it. Never accidentally restart grace on each webhook retry.

After trial/grace/paid access expires, the shop can sign in, read existing records, obtain exports, and manage billing. Block new orders, new uploads, and new review requests. Existing already-sent customer requests remain usable until their own expiry; permit their bounded decisions to be recorded without granting new shop write access. Explain this behavior consistently in UI and tests.

Never delete customer data merely because a subscription ends. Provide a documented owner-authorized closure process that removes data and files after any stated confirmation/grace window. Choose and document a concrete procedure; never claim automatic deletion unless it actually runs. Subscription cancellation and data deletion must be separate actions.

Use Stripe test mode locally. Do not create live charges, live price objects, or production subscriptions as part of implementation. Test fixtures and billing bypasses must be visibly marked and rejected by production configuration validation.

## 15. Security, privacy, and operational quality

These controls are part of a working multi-tenant product, not a separate compliance project:

- Check authentication, membership, role, entitlement, input validation, and resource relationships on every relevant server mutation.
- Protect session actions against cross-site submission according to the framework/auth integration. Rate-limit login-sensitive flows, invitations, and public token endpoints using a store that works across production instances.
- Sanitize/render comments and notes as text. Protect against stored script injection and unsafe filenames.
- No public file buckets, service secrets in client bundles, unrestricted storage signing endpoints, or workspace authorization inferred solely from a URL parameter.
- Do not log customer proof tokens, raw outbound email bodies, personal notes, credentials, payment details, or full request bodies. Use scoped IDs and safe operational metadata.
- Use hosted payment pages; do not collect card details directly.
- Index order search and pagination by workspace. Return bounded results and useful loading/error/empty states.
- Show save failures and retry choices; never clear unsaved input on a failed write. Disable duplicate submissions while still enforcing server idempotency.
- Use optimistic concurrency/version checks on contested edits so one employee cannot silently overwrite another's intake changes.
- Keep security-sensitive history on the server. Browser-local storage is acceptable for harmless UI preferences, never for authoritative orders or entitlements.
- Provide a safe health/readiness endpoint with no secret configuration values.
- Document database backup configuration, file backup/export considerations, restore procedure, migration deployment, and recovery limitations. Do not claim a backup exists because instructions were written.

Collect only the personal data required for the workflow. A typed name and timestamp are sufficient for this release; do not add invasive device fingerprinting or location collection. Any infrastructure access logs should follow the documented retention policy.

## 16. Demo and seed requirements

Provide two separate experiences:

1. A public read-only tour with synthetic records, clearly labeled “Demo — fictional shop and orders.” It must not expose a privileged login or allow arbitrary visitors to create server-side records or send emails.
2. A development-only seeded workspace and test accounts for exercising mutations end to end. Generate or document local credentials safely; do not ship universal working credentials to production.

Seed a small set of coherent fictional orders across draft, pending review, changes requested, approved, in production, ready for pickup, and completed. Respect lifecycle chronology and count totals. No fake revenue, client testimonials, fabricated live activity, or real company logos.

Production seed commands must require an explicit environment guard and must never run automatically against a real shop. New real workspaces start empty with a short onboarding checklist, not prepopulated fake customers.

## 17. Implementation sequence

Work through these stages in order. Keep a concise implementation checklist and persist progress in the repository so work can resume after a context reset.

### Stage A — Foundation and domain model

Inspect repository instructions, choose compatible dependencies, scaffold the app if needed, configure local services, create migrations/RLS/private buckets, and implement authentication, workspace creation, membership, and seed data. Verify workspace isolation early.

### Stage B — Core orders

Implement customers, order list/detail, garment size counts, discrepancy reconciliation, condition photos, and instructions. Complete a real database-backed create/edit/refresh flow before polishing secondary screens.

### Stage C — Proof approval

Implement immutable bundles, secure links, public review UI, decisions, version replacement, invalidation, and atomic race handling. This is the highest-priority feature after basic persistence.

### Stage D — Production and handoff

Add start-production gating, production snapshots/counts, exceptions, pickup, history, QR order sheets, PDFs, and exports.

### Stage E — Commercial operation

Add team invitations, settings, subscription checkout/portal/webhooks, entitlements, outbox worker/templates, and configuration status. Test real integrations in their test/local modes when credentials/services are available.

### Stage F — Product finish and delivery

Complete marketing/demo, responsive and accessibility passes, regression/security tests, operating docs, founder walkthrough, and the running local app. Fix identified defects before declaring completion.

Do not spend the entire session polishing marketing while the approval workflow is unfinished. Do not respond with only this plan; implement it.

## 18. Tests and release acceptance

Tests must exercise real authorization and transitions, not only reproduce helper implementation. Use the local database/auth stack for integration tests and isolate test data.

Required scenarios:

1. Owner signs up, verifies through the local email flow, completes onboarding once, and creates an order that survives reload.
2. A staff invitation can be accepted only by its intended authenticated email; expired/revoked invites fail, and removed staff lose access.
3. A second workspace cannot read, mutate, export, or sign downloads for the first workspace, including direct crafted API/database/storage requests.
4. Expected/received quantities validate correctly; a discrepancy prevents a final proof request until reconciled with history.
5. A customer requests changes to version 1, then approves version 2; old links cannot approve the replacement or change an old decision.
6. Concurrent approve/request-changes calls yield exactly one valid decision. Repeated approvals do not create duplicate history, emails, or production readiness.
7. Expired/revoked/wrong tokens reveal no customer information; only the linked bundle's files can be fetched.
8. Editing a production-relevant field after approval invalidates readiness; editing an internal note does not. Production starts only against the current valid snapshot.
9. Production snapshot edits are blocked; completed plus exception counts reconcile before ready-for-pickup; collection requires a named collector.
10. Print/PDF/QR/export content is correct, and staff-only notes never leak into public review or customer-facing PDFs.
11. Invalid uploads and cross-workspace attachment references fail. Quotas and concurrent upload reservations are enforced.
12. Stripe test webhook signatures, duplicate/out-of-order events, immediate subscription start, cancellation, payment failure/recovery, and entitlement expiry behave as documented.
13. Forging a checkout success URL does not grant access; non-owners cannot access billing controls.
14. Expired trial/paid access preserves read/export/billing access, blocks new work, and still permits a valid already-sent customer decision.
15. Failed email delivery is visible and retryable without losing the original action or falsely claiming delivery. Production cannot enable local billing bypass/demo write credentials.

Run type checks, lint, focused automated tests, and a production build using the repository's scripts. Use a browser to inspect desktop and mobile layouts and exercise the full fictional order story. Keep screenshots used for internal QA local unless requested as deliverables. Check keyboard operation, focus, form labels, long customer names, empty lists, slow requests, failed saves, and expired links.

If a service is unavailable, report exactly which checks were blocked and which passed. Do not count mocked billing tests as a verified provider checkout, or static sample data as a verified database flow.

## 19. Required repository documentation

Deliver these with the code:

- `README.md`: setup, architecture, actual commands, local access, environment requirements, and known limitations.
- `.env.example`: commented placeholders matching the implemented code.
- Committed database migrations, RLS/storage policies, and guarded development seed scripts.
- `docs/PRODUCT_RULES.md`: state transitions, approval/version invalidation, count reconciliation, roles, and entitlements.
- `docs/OPERATIONS.md`: email worker, webhooks, sender/domain setup, billing failure handling, export/deletion, backups/restore, migration and rollback considerations.
- `docs/LAUNCH_CHECKLIST.md`: concrete remaining production configuration and verification, with no false checked boxes.
- `docs/FIRST_CUSTOMER_WALKTHROUGH.md`: five-minute demo and owner onboarding instructions using the actual implemented product.
- `docs/BUILD_STATUS.md`: implemented features, tests run, actual external integration status, deferred scope, and next resumption point if incomplete.

For a new repo, provide convenient scripts such as `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`, and documented database start/migrate/seed commands. Use whatever exact commands the final implementation genuinely supports.

## 20. Founder demonstration and first-customer readiness

The founder should be able to show this sequence in about five minutes:

1. Open the shop order list and create a customer/order.
2. Record garments and photograph an existing condition.
3. Show a count discrepancy and reconcile it.
4. Upload a proof and open its customer link in a separate browser context.
5. Request a change, send a replacement, and approve that exact version.
6. Show that production was blocked before approval and is now available.
7. Print the order sheet, record completion, and record pickup.
8. Explain the $39/month subscription and open configured test checkout.

Include a practical onboarding checklist: verify the owner's email, set shop identity/timezone, add their own existing policy, invite staff if needed, and process the first actual order. Real customer records must never be mixed with public demo records.

Do not send outreach, contact shops, create live charges, publish the site, or claim the founder has customers as part of this build. The founder handles sales and production launch decisions. Prepare a concrete, reviewable product and clear configuration steps so those decisions can follow immediately.

## 21. Final delivery format for the coding agent

Your final response must state:

1. What is implemented and genuinely working.
2. The exact running localhost URL and any environment-provided preview URL.
3. How to access the public demo and development test workspace safely.
4. Which checks passed and which could not run.
5. External credentials/configuration still needed for production, with links to the repository setup docs.
6. Material limitations or unresolved defects.

Do not claim launch readiness if tenant isolation, approval integrity, persistence, or required billing behavior is unverified. Continue all unblocked implementation work before stopping. If the environment prevents completing a requirement, leave code and documentation at a concrete resumption point instead of silently replacing it with a simulation.

**Begin implementation now. Read the repository instructions, establish the local data/auth foundation, and build the complete order approval journey first.**
