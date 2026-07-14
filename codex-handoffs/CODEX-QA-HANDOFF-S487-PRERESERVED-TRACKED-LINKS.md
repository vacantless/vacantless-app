# Codex QA handoff — S487 distribution hardening #2: per-channel pre-reserved `?p=` tracked links

**Base:** app HEAD b1ff32f (S486, live). **Migration:** 0144 (S487b Codex-P3 fold — narrow partial unique index). **Server surface:** none new.
**Design:** HARDENING2-PRERESERVED-TRACKED-LINKS-DESIGN-S487.md (project root).

## What this does (one line)
Reserve one `listing_posts` row per (property, co-pilot channel) in `status='draft'` (url null, legal under the 0122 CHECK) at run-launch, so the co-pilot's tracked `?p=<postId>` inquiry link is FINAL before the operator posts. `completeCopilotPost` promotes the SAME row to live in place at proof time (its existing update path). Per-channel attribution now works from the first click instead of only after mark-live.

## Why it's safe / proof-before-Live NOT weakened
- Reservation only ever writes `status='draft', url=null`. The ONLY path that sets `status='live'` + a url is still `completeCopilotPost` (unchanged), gated by `canMarkCopilotLive` (S485 listing allowlist) + the S482b CAS/proof-first/terminal-flip-last invariants. `distribution-actions.ts` is untouched.
- `submit_public_lead` (migration 0014) resolves `?p=` by `id + property_id` only (no status filter), so a draft tracker attributes leads correctly — verified in the RPC body.
- A reserved draft carries no live claim anywhere: `hasLivePost` / "where it's posted" / analytics `daysLive` all key on `status='live'`. The where-posted tracker additionally HIDES reserved-but-unposted rows (see page.tsx change) so the S486 landlord-readable tracker stays clean.
- Consumers (page.tsx:~1183, copilot-sidecar.ts:~223) already build the link from `r.listing_post_id` gated on `linkIsLive`; they are UNCHANGED — the link simply lights up once the row is reserved AND the public page is live.


## S487b — Codex P3 fold (duplicate-submit orphan draft)
Codex P3: a rapid double-submit / concurrent run-launch for the same co-pilot channel with no existing tracker could pass the in-code reuse check in two requests at once and insert TWO blank drafts; only one gets referenced by the run item, orphaning the other blank Draft (which the where-posted filter, hiding only run-referenced blank drafts, would then surface).

Fold:
- **NEW migration 0144** `listing_posts_blank_draft_unique` — a PARTIAL unique index `(property_id, portal) WHERE status='draft' AND url IS NULL`. At most one blank reservation draft per (property, portal). NARROW by design: constrains only url-less drafts, so it never conflicts with a real posted draft/live row that carries a url (the "Variant A" pair) or multiple live posts. Pre-flight (2026-07-14) confirmed ZERO existing blank-draft duplicates → builds cleanly. Reversible (drop index).
- **actions.ts** — both reservation create-branches (startDistributionRun + addRunChannel): on insert error (the unique violation from a concurrent racer) RE-SELECT the winner's blank draft `(property_id, portal, status='draft', url is null)` and reuse it, so both requests converge on ONE tracker. No orphan.

Re-gated on-device: `tsc --noEmit` exit 0; `git diff --check` clean; 4 tracked files (+232/-1) + new migration 0144.

## Files changed (4; +203/-1; `git diff --check` clean; `tsc --noEmit` clean on-device)
1. **lib/listing-distribution.ts** — NEW pure `reservableTrackerId(posts, portal)`: prefer a `live` tracker, else newest non-`removed`, else null (create). No IO.
2. **app/dashboard/properties/actions.ts**
   - `startDistributionRun`: after `plans`, reserve for each plan where `!plan.listingPostId && isCopilotChannel(plan.key) && isPortalKey(plan.key)` — `reservableTrackerId(postRows…)` reuse, else insert `{org=property's own org, property, portal, status:'draft', url:null}`; thread into the run-items upsert `listing_post_id: plan.listingPostId ?? reservedByChannel.get(plan.key) ?? null`.
   - `addRunChannel`: same reservation for a newly-added co-pilot channel, but ONLY when no run item for that channel exists yet (the `ignoreDuplicates` upsert leaves an existing item untouched → no orphaned draft).
3. **app/dashboard/properties/[id]/page.tsx** — before `postsByPortal`, build `reservedPlumbingPostIds` (draft + blank-url rows referenced by a run item's `listing_post_id`, via one RLS-scoped `.in()` query only when such drafts exist) and `continue` past them when building the where-posted map. A manual url-less draft that no run item references still shows.
4. **scripts/test-listing-distribution.ts** — 7 `reservableTrackerId` cases (empty/removed→null; single live; live-over-newer-draft; newest non-removed; portal filter; ignore newer removed).

## Gates
- On-device (Cowork): `git diff --check` clean; `npx tsc --noEmit` exit 0. Diff scope = exactly the 4 files above.
- **Migration:** apply 0144 to prod (Supabase) as part of the deploy.
- **Mac (please run):** `npx tsx scripts/test-listing-distribution.ts` (+ the other test-distribution-* still green), `npm run lint`, `npm run build`. tsx is Mac-only (KI746); Cowork can't run it on the device bridge.

## Review focus (where to be adversarial)
1. **Orphaned/duplicate drafts:** does `startDistributionRun` ever create a 2nd draft when a non-removed tracker already exists? (reuse path should catch live AND draft.) Does `addRunChannel` create a draft for an already-present channel? (guarded by the existingItem check + ignoreDuplicates.)
2. **RLS / org stamping:** reservation inserts stamp `organization_id` from the RESOURCE's own org (prop.organization_id / run.organization_id), never getCurrentOrg/client (KI748).
3. **Promotion, not duplication:** completeCopilotPost on a channel whose run item already points at the reserved draft must UPDATE that row to live (path at distribution-actions.ts:707-716), not insert a new one.
4. **where-posted filter:** confirm it hides ONLY run-referenced url-less drafts and never a live post or a manual url-bearing draft; the extra `.in()` query is RLS-scoped and skipped when no url-less drafts exist.
5. **Draft attribution honesty:** a lead via a draft tracker's `?p=` stamps the channel source while the channel still reads "not live" in the operator UI — intended (attribution ≠ live claim).
