# DECISION S695: which syndication surfaces survive DECISION-S694

Date: 2026-09-10 (Session 695). Follows `DECISION-S694-SYNDICATION-BECOMES-A-PAID-ADDON-COLLECT-ONCE-ONE-BUTTON.md`, which kills the self-guided posting path. This is the first move it asked for: decide what survives, then re-scope the plain-language gate so the baseline stops counting screens that are being removed. No copy was swept in this session and no product code was deleted: the gate is re-scoped, the deletion itself is later work.

## The test used

A surface survives if a landlord still reads it after the change: the one intake, the sign-in step, the one button, the status afterwards, the catalog, the property page, the dashboard home, and the engine modules that build those sentences. A surface goes if its purpose is to teach the landlord to post on a portal himself. Mixed files were judged by what the file is for, not by what it happens to import.

## Removed: the self-guided posting path (9 files leave the gate)

| File | What it is | Offenders it carried |
|---|---|---|
| `lib/listing-fill-sheet.ts` | per-portal field sheet: the value to paste into each portal form, in order, with a copy button | 200 |
| `lib/listing-guardrails.ts` | per-portal "before you post" gotchas for the human poster | 190 |
| `lib/distribution-copilot.ts` | browser co-pilot script model: the ordered steps a person follows on Kijiji or Facebook | 31 |
| `app/dashboard/properties/[id]/copilot/[itemId]/sidecar-copilot.tsx` | pop-out co-pilot window | 24 |
| `app/dashboard/properties/[id]/qa-checker.tsx` | paste your live ad text, we check it | 2 |
| `app/dashboard/properties/[id]/distribute-tab.tsx` | the assisted-manual command centre (3,780 lines; its header says "assisted-manual only") | 0 |
| `app/dashboard/properties/[id]/launch-run-panel.tsx` | assisted launch run: pick channels, work each as a checklist, paste the live URL | 0 |
| `app/dashboard/properties/[id]/copilot-panel.tsx` | in-page browser co-pilot | 0 |
| `app/dashboard/properties/[id]/fill-sheet-card.tsx` | the fill sheet rendered | 0 |

447 of the 1140 baseline offenders sat in these files (counts are the gate's enforced `totals`, occurrences not distinct strings). **Baseline 1140 to 693.** Gate assertions 236 to 270.

Same area, never under the gate (not in `app/dashboard` or not prefixed `distribution-`/`listing-`), listed so the deletion is complete: `components/before-you-post.tsx`, `lib/copilot-sidecar.ts`, `lib/extension-kit.ts`, `lib/post-publish-qa.ts`, `app/dashboard/properties/[id]/copilot/[itemId]/page.tsx`, the S483 Chrome extension (`vacantless-extension/`), and the `browser_copilot` transport in the capability matrix.

## Survives (48 surfaces stay gated)

- **The intake:** `add-details/page.tsx`, `add-details/question-sheet-form.tsx` (the S692 question sheet: this becomes THE screen).
- **The sign-in step:** `link-portals/page.tsx`, `connect-tiles.tsx`. Accounts are information a portal requires; collecting them once is part of "collect once". Whether the tiles stay a separate stage or fold into the intake is a build decision, not a survival one.
- **The button and after:** `send-live/page.tsx`, `after-live/page.tsx`, `confirm-publish-button.tsx`, `publish-everywhere.tsx` (today's button host on the property page, until the wizard replaces it), `channel-publish-rail.tsx` (the per-site state chips: WP2's target), `lifecycle-rail.tsx`, `next-action-card.tsx`.
- **The list and the home:** `properties/page.tsx`, `readiness-chips.tsx`, `getting-started-card.tsx`, `launch-checklist.tsx`, `(wizard)/getting-started/page.tsx`, `today-lane.tsx`, `dashboard-nav.tsx`.
- **The property page:** `properties/[id]/page.tsx` (154 offenders; a share of them are the sections it renders for the removed files and go with them), `listing-copy-card.tsx`, `marketing-kit-card.tsx`, `get-online-view.tsx`.
- **Catalog and states:** `lib/distribution-channels.ts`, `lib/distribution-channel-tile-statuses.ts`, `lib/distribution-channel-contracts.ts`.
- **The engine that builds landlord sentences:** `lib/distribution-publish.ts` (the button's state model), `lib/distribution-run.ts` (kept on purpose: its run-item state machine feeds the worker cron; only its `buildRunSteps` checklist copy belongs to the removed path and most of its 38 offenders fall when that is cut), `lib/distribution-capabilities.ts`, `lib/distribution-verification.ts`, `lib/distribution-freshness.ts`, `lib/distribution-stuck-sweep.ts`, `lib/distribution-analytics.ts`, `lib/distribution-launch-coverage.ts`, `lib/distribution-partner.ts`, `lib/listing-distribution.ts`, `lib/listing-copy.ts`, `lib/listing-description.ts` (the ad writer: the automation still writes the ad), `lib/listing-quality.ts`, `lib/listing-health.ts`, `lib/listing-state.ts`.
- **Not syndication but landlord-facing and already gated:** `settings/page.tsx` (115), `automations/page.tsx`, `facebook-connect/page.tsx`, `properties/new/*`, `standard-policy/page.tsx`, `messages/en.json`, `messages/fr.json`.

## What changed in the gate

- A new `BEING_REMOVED` list next to `OUT_OF_SCOPE`. A file on it is excused from discovery while it exists. Once it is deleted the gate fails with "it is gone: delete its BEING_REMOVED entry", so the list cannot outlive the code. It cannot also be in `SURFACES` or `OUT_OF_SCOPE`.
- The gate prints a deletion checklist on every run: every file under `app/`, `lib/` and `components/` that still imports a module being removed, gated or not. Today 15 files: `properties/[id]/page.tsx` (six of them), `publish-everywhere.tsx`, `copilot/[itemId]/page.tsx`, `actions.ts`, `distribution-actions.ts`, `lib/copilot-sidecar.ts`, `lib/extension-kit.ts`, `components/before-you-post.tsx`, and the seven `splitAddressUnit` importers. A note, not a failure; it goes quiet as the code is cut.
- The baseline was rebuilt with `--update-baseline --accept-new`, the only path that drops surfaces. The gate refused the plain run first, as designed: "surfaces the baseline covers are no longer gated" and "surfaces yield far fewer copy strings".

## Where the 693 remaining offenders sit

`properties/[id]/page.tsx` 154, `settings/page.tsx` 115, `distribution-publish.ts` 99, `distribution-channel-contracts.ts` 45, `distribution-run.ts` 38, `distribution-launch-coverage.ts` 31, `listing-description.ts` 22, `automations/page.tsx` 22, then a long tail. The next sweep target under the new direction is the intake and the button, not the property page: `add-details`, `send-live`, `after-live`, `connect-tiles` are all already at 0 to 2, so the real work there is fewer words, not cleaner words.

## Deletion notes for whoever cuts the code

- `splitAddressUnit()` lives in `lib/listing-fill-sheet.ts` and is imported by `expenses/page.tsx`, `maintenance/page.tsx`, `money/reconcile/page.tsx`, `standard-policy/page.tsx`, `lib/building-notices.ts`, `lib/rent-roll.ts`, `lib/statements.ts`. Move it to its own module first.
- `buildRunSteps()` in `lib/distribution-run.ts` is called by `app/api/cron/distribution-worker/route.ts` (line 430) and handed to `composePostWithAgent` as context. Cutting the checklist copy changes what the composer sees; check the composer prompt before removing.
- `distribute-tab.tsx` hosts the tracked `listing_posts` rows and the concierge request forms. Those are the status a landlord still needs after the button; they need a home in `after-live` before the tab goes.
- `distributionWizardEnabled()` gates the wizard stages. The wizard is dark in PROD today. Under S694 it is the product; flipping it is a Noam decision.

## Cut, first pass (same session, after the decision)

Seven of the nine left the tree in S695 (commit script `COMMIT-S695-CUT-SELF-GUIDED-PATH.sh`, commit only). Moved to `_to_delete/s695-self-guided/` on the Mac so the old code is still readable; git sees them as deleted. `distribute-tab.tsx` and `launch-run-panel.tsx` stay until `after-live` takes the tracked-post rows.

Gone: `lib/listing-fill-sheet.ts`, `lib/listing-guardrails.ts`, `lib/distribution-copilot.ts`, `lib/copilot-sidecar.ts`, `lib/post-publish-qa.ts`, `lib/extension-kit.ts`, `components/before-you-post.tsx`, `fill-sheet-card.tsx`, `copilot-panel.tsx`, `qa-checker.tsx`, `copilot/[itemId]/*` (page + sidecar), `app/api/extension/kit/route.ts`, and five test scripts. `splitAddressUnit` now lives in `lib/address-unit.ts`; `isCopilotChannel` in `lib/distribution-capabilities.ts`. The S483 Chrome extension (`vacantless-extension/`, its own repo) now has no endpoint to talk to; archive it.

Behaviour that changed, each found by a fresh reviewer and fixed before commit:

- **The live gate got weaker and was put back.** `completeCopilotPost` held a positive per-portal ad-link allowlist; `validateListingPost` only checked "is a web URL", so with the co-pilot gone `https://www.kijiji.ca/` would have marked Kijiji live. The allowlist moved into `validateListingPost` (`kijiji_url_required`, `facebook_url_required`, `viewit_url_required`). Every live Kijiji and Facebook row in PROD on 2026-09-10 matches the shapes (the one `/share/` link is expired).
- **A form-flipped site now counts as live on send-live.** `updateRunItem` never wrote a `distribution_verifications` row; `stage3-send-live` needs one. `recordVerificationAndAttempt` moved to `lib/distribution-verification-write.ts` and the flip writes `verified_live` (actor operator) first, fail-closed to `?runerr=prooffail`.
- **Publish Everywhere rows.** "Open this site" (sidecar) became "Add this site" (stages the run item and returns), "Sign in and continue" became "Sign in once" (connect tiles when the wizard is on, the channel settings row when off), and the item row shows "Have us post it" (the desk) or, without the add-on, a link to billing. The chips read "We post it". No branch is a dead end.
- **The assisted checklist** lost its field-sheet and gotchas steps; the empty "What to paste on each site" block left the property page; nine `dist=copilot_*` notices with no producer became two (`needs_valid_url`, `prooffail`) with real ones.

Gate after the cut: baseline 693 to 680 (the pawl tightened on the removed copy), 249 assertions, 48 surfaces. tsc, eslint and 241 test scripts green apart from the three known reds.

Still to do under this decision: fold `startSitePost` staging into the concierge request so an entitled landlord is one click, not two; the `hasFillSheet` / `hasGuardrails` flags in the channel matrix are now unused data; the concierge upsell copy still says "Done-for-you" (baseline offender) and waits on the add-on pricing decision. The launch checklist and control room went in the second pass below.

## Cut, second pass (same session): the checklist and the control room

`launch-run-panel.tsx` is gone. `distribute-tab.tsx` went from 3,780 lines to 1,577: the pre-Publish-Everywhere simple surface (`SimpleGetOnline`, never rendered under PROD's flags: `PUBLISH_SIMPLE_DEFAULT_ENABLED` and `PUBLISH_EVERYWHERE_ENABLED` are both true), the control-room summary and the basics / posting-mode / next-action / health / automation / quality / analytics panels are deleted. `page.tsx` lost the work that only fed them (4,473 to 4,062 lines), including a per-view `organizations.distribution_view_mode` query and the start-channel picker build.

**One correction to this decision.** `distribute-tab.tsx` does not go yet, and it is not purely self-guided: its channel cards own the only Connect Facebook Page and Disconnect controls in the product (`fa4a808`, rule 124), and Meta App Review is in progress with a freeze on the Meta OAuth path until 2026-09-22. So the tab survives as: header, Publish Everywhere (the simple surface), and the channel cards behind "Advanced tools" (tracked ad links, Facebook Page / Instagram connect and disconnect, partner feed status). After the verdict: move connect / disconnect and partner status to Settings, give the tracked-post rows a home under Publish Everywhere, then delete the rest. `channel-publish-rail.tsx` has no renderer left in the app (only its test); it goes with that step.

**Behaviour that changed:**

- **A hand-recorded live ad now flips its run item.** "Save the link to your ad" (`addListingPost` / `updateListingPost`) finds the active run item for that site and, through the same `verified_live` proof write the desk uses, marks it live. Before this only the deleted co-pilot and checklist flipped items, so a hand-posted Kijiji ad read "posted" on the property page and "still posting" on the send-live stage. Fail-closed: no proof row, no flip; the property comes from the updated row, never the form.
- **Server actions with no UI caller left** (kept, the desk may reuse): `startDistributionRun`, `addRunChannel`, `cancelDistributionRun`, `updateRunItem`, `recordItemProof`, `verifyPublicPage`, `verifyOrgFeedInclusion`, `setRelistRadarStandingAutoRefresh` (`auto_submit_allowed` is false on every PROD account), `confirmLeaseupTakedownRemovedAction`. A landlord who taps "Add this site" by mistake cannot remove the staged item; under S694 every site gets one anyway, so this is accepted for now.
- Kijiji spend authorization still lives in Settings (`updateDistributionChannelAccount`); the concierge pack checkout stays in the tab header; `requestConciergePublish` and `authorizeAutopilotSubmit` stay in Publish Everywhere.
- `#publish-control-room` and `#publish-checklist` links (properties list, property page, tab) now land on `#distribute-header`.

Gate after this pass: baseline 679, 246 assertions. Reviewer: no P1; two P2 (the run-item flip above, the dead view-mode query) and P3s fixed.

## Open questions this does not answer

The four from DECISION-S694 stand (price and boundary of the add-on, who is behind the button, collect for reachable portals only, what a stuck post looks like). One more from this session: does `link-portals` stay its own step, or does sign-in become a row on the intake? Survival is the same either way.
