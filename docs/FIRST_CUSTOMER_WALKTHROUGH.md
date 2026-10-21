# Founder walkthrough

## Review the UI now

Open http://127.0.0.1:3000/demo. No account is needed. “Demo — fictional shop and orders” is displayed throughout. These are read-only synthetic records, not evidence of a live customer or verified persistent workflow.

1. On **Orders**, search for “Northline”. Open #1048 and show 24 expected, 23 received: one medium is missing.
2. Show the garment sizes, decoration instructions, condition-photo section, history and internal notes.
3. Return to Orders. Filter **Awaiting approval**, **In production**, or **Ready for pickup** to inspect the different screens.
4. Click **Walk through the order**. Advance through seven scenes: intake, corrected count, version 1, requested change, version 2 approval, production, collection. Scenes explain the behavior without pretending to save records.
5. Open **Explore customer view**. The page shows a proof, counts, specs, policy and decision explanation, without internal notes or the shop order list.
6. Review **Shop settings → Plan & billing** and the landing pricing section: $39/month, three total members, 2 GiB, seven-day app trial. Billing is visibly unconfigured.

## Verify the real journey when Supabase is running

Follow README setup and run the guarded seed. Obtain the development login from ignored `.local/seed-credentials.json` on your own machine. Do not publish it. Log in at http://127.0.0.1:3000/login to **Cedar Stitch Demo (development)**. Real newly onboarded shops start empty.

1. Create an order with a synthetic `example.test` customer email. Add one garment group: 6 S, 8 M, 6 L, 4 XL; initially receive 7 M. Record a reason.
2. Upload a JPEG/PNG/WebP condition photo with a condition note. Reload and confirm both the intake and private photo persist.
3. Correct received M to 8 with “Customer delivered the missing medium”. Confirm old/new values remain in history.
4. Upload a genuine proof file (fictional fixtures are in `supabase/fixtures`). Select the file and create the customer review link. Copy it now; plaintext bearer tokens are not retained for staff retrieval. No email delivery is claimed.
5. Open the link in a separate private browser window. Request a smaller logo with a written reason. The shop sees changes requested for that exact version.
6. Upload/select the revised artwork and create a new version/link. Approve in the private window with a full name and both separate unchecked acknowledgments. Check the old version still shows its earlier change request and cannot approve the replacement.
7. Start production. The approved specification is locked. Record 24 completed and 0 exceptions, mark ready, then record the full-order collection with a named collector and confirmation.
8. Download the order sheet and approval record PDFs. The sheet QR opens a staff-authenticated order route. Try the second seeded owner and confirm first-shop records/files/exports are inaccessible.

**Current checkpoint:** local Supabase is running, and this entire browser journey has passed with real persisted data. Signup/local verification/recovery and team acceptance/removal have also passed. Repeat with `pnpm test:connected`, `pnpm test:workflow`, and `pnpm test:auth` under the explicit local development guard. Stripe code is implemented, but actual test checkout/webhooks still require provider configuration and verification.

Team invitations and local email are available for review: open Settings → Team as the owner, create a private invitation, sign up/verify as its intended email, accept, and confirm removal revokes access. For emails, explicitly select the queue option on a review/invitation form or use the ready-order pickup notice. Run `pnpm email:work` or `pnpm test:email`, inspect ignored `.local/outbox/` files, and check the accurate development-outbox state under Shop profile. Parallel local worker checks passed; no provider delivery is claimed.

Customer management is available under **Customers**. Search by name/company/email/phone, open a customer, update their contact details or private notes, save, and reload to verify persistence. Directory and order-history pages reach older records beyond the former 200-record cap. A second stale edit or duplicate customer email fails with input retained. Updates do not send email or rewrite sent proofs and queued recipients. `pnpm test:customers` verifies these cases against local Supabase using isolated fictional fixtures.

Order controls are available on each real order. Assign an active member, then confirm the current approval remains valid. For cancellation review, create a separate fictional draft/open job, enter a reason, and explicitly confirm; pending review links become inactive and history remains. Archive a collected/cancelled job, find it under **Archived orders**, open its files/PDF/history, then restore it to **Current orders**. Restoring visibility does not reopen the job. `pnpm test:controls` covers these flows and independent production/cancellation races.

The main **Orders** screen now searches all matching records and pages 24 at a time. Combine status, assigned-member, current/archived, and sort choices, then use **Apply filters**. Copy the resulting URL, reload it, open an order, and return using **All orders** to verify the same page/filter state. A teammate in the same shop can open the saved view; another shop cannot see its records. Both due-date sorts put undated work last. `pnpm test:orders` verifies 600 current and 205 archived fictional records, including mobile search/paging and browser back/forward behavior.

## First actual shop onboarding, after launch acceptance

- Verify the owner's email and create their own empty workspace.
- Set their shop name, timezone, contact and their own reviewed garment policy.
- Configure/test subscription and sender/provider setup; explain the app trial and immediate paid-checkout start.
- Invite staff only after the implemented invitation flow is accepted.
- Process one actual order with permission to store its data; show how proof links grant bearer access.
- Explain storage limits, exports, support contact, cancellation versus deletion, and backup limitations accurately.

The founder handles outreach, commercial commitments, and production authorization. The build agent has not contacted shops, created live charges, or deployed the app.
