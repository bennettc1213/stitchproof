# UI makeover checkpoint

The founder requested a full visual redesign inspired by SideShift, with larger text, more space, a new palette, and a portal preview on the right. This replaces the original handoff's forest-green visual direction.

## Reference and scope

Reviewed [SideShift's public homepage and pricing](https://sideshift.app/) and its [public campaign-management product preview](https://sideshift.app/platform/campaign-management). The app entry redirects to signup; no private dashboard was accessed. The reference informed the bold heading scale, clear hierarchy, neutral surfaces, rounded controls, and product-led presentation. StitchProof retains its own branding, copy, fictional records, workflow, and single $39/month plan.

## Implemented

- Replaced the full stylesheet with a cobalt, charcoal, white, and cool-gray design system. Main body text is 16px; forms use 16px inputs, main workspace headings 32–38px, and marketing headings approximately 43–64px. Supporting labels remain smaller; the miniature portal is intentionally scaled down.
- Increased app navigation/table typography, spacing, field heights, and panel padding. Mobile order tables become readable order cards with visible status, quantity, and due date.
- Redesigned landing-page navigation, hero, product explanation, pricing, FAQ, and footer. Pricing retains the seven-day no-card app trial and immediate paid-checkout wording.
- Added a right-hand, code-rendered portal preview cycling through fictional orders, reconciled intake, exact proof approval, and pickup. It has manual navigation, pause/play, a full-demo link, reduced-motion support, and no backend writes.
- Order details now use four keyboard-operated tabs rather than displaying every primary section at once. All tab contents remain mounted to preserve unsaved form state; the inactive panels are hidden accessibly. Printing reveals all panels.
- Applied the visual system to customer records, settings, authentication, the standalone customer proof-review page, and the walkthrough.
- Local-only preview remains at http://127.0.0.1:3000. Full app tour: http://127.0.0.1:3000/demo.

## Verification and remaining limits

Desktop/mobile browser tests exercise search/filter/detail, walkthroughs, preview screen selection and automatic advancement, pause/play, reduced motion, keyboard tab navigation, and layout overflow. Axe checks the public homepage, orders, order detail, customer review, and signup. TypeScript, lint, and production compilation are run for the checkpoint. Final results are recorded in BUILD_STATUS.md.

Docker/Supabase now run locally. The complete database-backed browser journey, authentication/recovery, team invitations/removal, private files, and local email workers passed. Stripe integration is implemented, but actual Stripe checkout/webhooks and external email delivery still need provider configuration and verification. See [current build status](BUILD_STATUS.md) for evidence and remaining launch work.
