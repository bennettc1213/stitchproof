# Product rules

## Roles and access

All shop records belong to a workspace. Membership is checked in PostgreSQL on each write; it is not inferred solely from a browser route or stale cookie. Direct authenticated table writes are revoked. Read policies consult current membership. Shop-policy changes, team administration, email status, and exports are owner-only.

Pending unexpired invitations reserve one of two staff seats. Invitations expire after seven days, require the intended verified email, and cannot join an account that already has a workspace. Replacements revoke old tokens. Team mutations serialize on the workspace; acceptance shares the onboarding user lock. Same-account acceptance retries succeed only while membership remains active. Removing staff revokes their accepted invitations and subsequent access; the owner cannot be removed. Revocation/removal remain available after entitlement expires, but new invitations/acceptance require active entitlement. Invitation creation is limited to ten per workspace per hour.

Public review visitors receive no anonymous SQL access. Server-only functions resolve a hashed bearer token to one immutable bundle. Downloads recheck either membership through a user-scoped SELECT or token access to that bundle's file list. No public Storage bucket or unrestricted signing endpoint exists.

## Authentication attempts

Login/signup/recovery server actions consume atomic shared database counters before calling Auth. Both successes and failures count. Per normalized email/action, fixed windows allow 10 login attempts per 10 minutes, 3 signups per hour, and 3 recovery requests per 15 minutes. Separate global minute ceilings allow 300 login attempts and 60 attempts for each other action; global denial does not create more identity rows. Counters saturate at limit + 1. Invalid input is rejected before consuming a counter.

Only HMAC-SHA256 identity digests, action/scope, timestamps and counts are stored; counter access and RPC invocation are service-only. No email/password/IP enters these rows, and request IP headers are not trusted. Bounded opportunistic cleanup removes up to 100 rows older than two hours per attempt; quiet installations may retain old rows until later traffic. A stable server-only secret is required across app instances; guard errors fail closed. Fixed-window boundaries permit bursts across windows. Direct public Supabase Auth calls bypass this app guard and require provider limits; these controls do not provide comprehensive denial-of-service protection.

## Customer records


Members with active entitlement may edit customer name, company, email, phone, and private notes. Emails are trimmed/lowercased and unique within a shop; duplicate-email edits fail without merging records. Customer edits require an expected revision, so competing saves cannot silently overwrite each other. A pending form keeps its original revision through history navigation; successful saves alone advance it. Validation/conflict errors preserve unsaved input.

The customer directory searches literal, case-insensitive name/company/email/phone text in PostgreSQL and pages 24 records at a time with an ID tie-breaker. Search text is never interpolated into PostgREST syntax. Customer details load by exact workspace-scoped ID, with independently paged order history; neither is limited to the latest 200 shop records. Read-only shops retain these reads but cannot edit. Removed staff lose RPC/read access. The public demo supports synthetic search and never offers editing.

Contact edits affect current linked order displays and future notifications. They never rewrite sent proof snapshots, recorded decisions, or already queued email recipients, and saving a customer never sends an email. Private customer notes stay inside authenticated shop records and the owner export.

## Intake

- Expected/received quantities are nonnegative whole numbers, up to 100,000 per size row. Groups and labels have bounded lengths and duplicate size labels are rejected.
- A draft may contain a discrepancy. An order becomes open when a valid intake and placement are saved. Every size must reconcile before a proof is sent.
- An intake write requires the expected order revision and a recorded reason. A stale write fails rather than overwriting another employee's work. The history event contains previous/new intake and instructions.
- Garment descriptions, sizes, counts, and production specifications are validated JSONB. Snapshots preserve the complete structured intake rather than reading mutable current fields later.

## Lifecycle

`draft → open → in_production → ready_for_pickup → completed`

Draft/open orders may become cancelled with a reason and explicit confirmation. Cancellation after production starts is rejected. Cancellation preserves files, snapshots, recorded decisions, and history, and revokes undecided review links immediately. Previously decided links retain their limited read-only receipt until normal expiry/revocation. The email worker purges inactive, unclaimed review messages on its next run; an already claimed/in-flight message may still reach the provider with an inactive link. Cancellation does not reopen an order or send a cancellation email.

Archiving is a visibility timestamp allowed only for collected/cancelled orders. Restoring visibility does not change lifecycle or reopen work. The current and archived lists filter and paginate in PostgreSQL without a 200-record cap. Direct details, authenticated files/PDFs, customer history, and complete exports retain archived records. Archive/restore requires active entitlement and records an event.

Any active member may assign an active order to the owner or an active staff member, or leave it unassigned. Assignment validates membership inside its transaction, records previous/new identities, increments the order revision, and leaves the approved specification/decisions untouched. Removed staff are no longer offered as choices; their previous identity is retained as a former-team-member assignment until reassigned. Assignment is informational and grants no additional permissions. Collected/cancelled orders retain their final assignment.

Assignment, cancellation, and archive/restore require the expected order revision. Edited controls retain that revision until a successful save, so validation and conflict failures preserve input. Cancellation and production start share the order lock and cannot both transition from the same open state. Do not imply that collected garments are the same thing as completed production quantities.

| Mutation          | Server/database prerequisite                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Save intake       | Member, active entitlement, expected revision, draft/open state, valid quantities, reason                                      |
| Send proof        | Verified member email, active entitlement, open order, fully reconciled intake, 1–10 ready proof files belonging to this order |
| Decide proof      | Current unexpired/unrevoked request, open order, current proof/spec revision, no conflicting existing decision                 |
| Start production  | Member, active entitlement, open order, current approved proof, reconciled counts, same current policy version                 |
| Mark ready        | In production; completed + exceptions exactly equal each garment group's received quantity; nonzero exceptions have a reason   |
| Record collection | Ready for pickup, named collector, explicit whole-order confirmation                                                           |

## Order directory

Order directory searches are literal and case-insensitive across title, customer contact/company fields, and order number. Status/assignment/current-or-archived filters apply before 24-record pagination. Sorting uses stable creation/ID tie-breakers; both due-date sorts put null dates last. Counts cover the full search/assignment/visibility scope before the selected status, rather than just one page. Approval status comes from the latest proof, decision, spec/policy revisions, and review expiry/revocation; a later proof supersedes older approvals. Attention detects differences at each size, even when summed counts match. Terminal orders are excluded from actionable approval/attention filters.

Saved URLs contain only whitelisted filters/sorts and bounded query/page values. Detail return links are reconstructed for `/app/orders` only, so a supplied `from` parameter cannot choose an external destination. A former member's UUID may filter that shop's retained historical assignments but grants no access. Every directory request independently verifies current workspace membership; expired entitlement permits reads, and removed staff/anonymous users cannot call it.

## Proof contract

Uploaded files are drafts until sending. Send creates an immutable numbered version and captures quantities, description/color, placement, design, dimensions, thread notes, exact text, customer-visible instructions, shop identity, policy/version, and immutable file identifiers/digests. It never copies internal notes. Sending a replacement revokes previous outstanding requests and preserves historical decisions.

Approval status is derived from proof/request/decision records, spec revisions, and policy versions. There is no employee-editable approved flag. Revoked/expired pending proofs require a new request. Internal notes preserve approval. Intake/specification/policy changes require fresh approval before production. Specifications are locked after production starts.

Tokens contain 256 random bits; authorization stores SHA-256 digests. Optional queued emails temporarily retain the bearer token in server-only outbox payloads until acceptance/local write or worker expiry/cancellation. Default link expiry is seven days. GET only reads; decisions require a Next server-action POST with framework origin protection. Both acknowledgments are initially unchecked. Approval requires a typed full name and the actual stored design/quantity and policy confirmation texts. Change requests require text. Concurrent decisions lock the order and request; repeat identical choices return the recorded outcome. A different decision cannot replace it.

A still-active decided link displays a limited receipt. Invalid/expired/revoked links show no customer details. Public review requests and files share database-backed minute counters: 60 per token digest and 1,000 globally. Rate counters expire after ten minutes and are committed separately from decision transactions. Tune this simple fixed-window limit after real usage testing; it is not a comprehensive denial-of-service defense.

The typed acknowledgment does not verify identity or establish legal enforceability. History is append-only through app permissions, not immutable against a database administrator.

## Files and records

Proofs accept JPEG/PNG/WebP/PDF; condition evidence accepts images. Initial limits: 10 MiB per file, 40 megapixels for image decode, 100 pages per PDF, 2 GiB per workspace. Content type, extension, detected magic bytes, decode/parse validity, authorization, and quota are checked server-side. Images are re-encoded to strip metadata. Uploaded timestamps do not prove a photograph's capture time.

Quota reservations atomically update workspace usage before upload. Known failures release the reservation once. Reservations expire after one hour and cannot be finalized afterward. The authenticated maintenance worker retires expired reservations, releases quota, and leases deletion of abandoned objects. It excludes every ready file and any sent-proof reference, and rechecks cleaned tombstones daily for late orphan writes. Parallel real Storage/quota checks passed. Production must schedule this worker; no scheduler is provisioned. Sent/approved proof blobs are never overwritten or deleted as routine cleanup.

Order sheet QR codes point to authenticated `/app/orders/[id]`, with no approval token. Customer-facing PDFs exclude internal notes. Approval-record PDFs label pending/change-requested decisions accurately and list file digests; artwork embedding remains a release task. Owner JSON export includes personal/internal records and an authenticated attachment manifest, not the binary file contents. Download paths always recheck current membership.

## Entitlements

Workspace creation begins a seven-day app-managed trial. Expired workspaces can sign in and read/export records; write RPCs reject new work. Existing already-sent customer decisions remain accepted until token expiry. No data is deleted merely because access expires.

The commercial plan is $39 USD/month, 1 owner + 2 staff, 2 GiB storage. Staff seats are enforced in PostgreSQL. Owner-only Stripe Checkout/Portal and raw signed webhooks are implemented, with server-resolved price/customer association, leases, session recovery, event deduplication, fresh provider reconciliation, paid-through/cancellation, and a persisted three-day payment-failure grace. Repeated failure events cannot restart grace; confirmed recovery clears it. Checkout starts payment immediately without a second Stripe trial. A browser return URL never grants paid access. Actual provider credentials and test checkout/webhook verification remain outstanding; missing Stripe does not prevent valid app-trial work.

## Transactional email

Optional review/invitation emails commit with their domain action. Decisions queue owner notifications atomically. Pickup notices are explicit, ready-order-only actions deduplicated per order. Normal sessions cannot select private email payloads. Only owners can view safe status summaries or request retries.

The secret-protected worker claims at most five messages with two-minute leases and SKIP LOCKED. Failed attempts back off from one minute, stop at six attempts, and cannot restart after the 23-hour provider-idempotency window. Provider acceptance requires a provider reference; delivery is never inferred. Local files use a distinct development-outbox state and are forbidden in production. Expired/revoked/replaced unsent bearer emails are cancelled and purged when the worker runs; successful payloads are purged immediately after finalization. Scheduler configuration and real provider checks remain launch requirements.
