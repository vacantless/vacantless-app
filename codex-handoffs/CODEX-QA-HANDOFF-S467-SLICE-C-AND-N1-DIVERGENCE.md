> **SUPERSEDED 2026-07-12 (wrap reconciliation).** Do NOT hand this to Codex. Both items were resolved the same day: S467 shipped the Slice C banner/harness; S468 (e9f4e4b) FIXED the /n1 blank-amount bug (root cause = Next 14.2 Data Cache caching the service-role client's cookieless GET fetches; fix = cache:no-store in lib/supabase/admin.ts + revalidate=0); S469 built the official LTB N1 PDF. Codex already reviewed S467-S469 and it was folded as S470 (507e887). Kept for history only.

# Codex handoff — S467: Slice C verification + a live /n1 render divergence to investigate

App HEAD: `44d1d5c` (unchanged this session). One STAGED doc-only commit (`DEPLOY-S467-SLICE-C-VERIFIED.sh`), not yet pushed.

Two asks: (A) sanity-check the Slice C verification + the doc change, and (B) help root-cause a reproduced live bug in the tenant-facing N1 render that we could not explain from the outside.

## A. Slice C (auto Stripe rate change) — now VERIFIED vs Stripe test mode

`updateStripeRentAmount`'s impure Subscription Schedule orchestration (previously banner'd `!!! LIVE-UNVERIFIED`) was exercised end-to-end against a Stripe TEST sandbox on a Test Clock via a new harness: `scripts/harness-stripe-slice-c.ts`. It imports the REAL `selectActiveSchedulePhase` + `validateStripeRentUpdate` and reconstructs `subscriptions.retrieve -> subscriptionSchedules.create({from_subscription}) -> selectActiveSchedulePhase -> subscriptionSchedules.update([phase1 end=effective, phase2 new price_data])`, then advances the clock past the effective date to force the annual transition. Result 13/0:
- phase 2 starts exactly on the effective date; no early bill (live price stays $2,200 until the boundary, flips to $2,241.80 after);
- after transition, `selectActiveSchedulePhase` picks the now-current phase; the pre-S462 `phases[0]` approach is REJECTED by Stripe (adversarial control); the S462 active-phase fix SUCCEEDS across the boundary.

The S467 commit is doc-only: rewrite the `LIVE-UNVERIFIED` banner in `app/dashboard/tenancies/stripe-rent-actions.ts` to a VERIFIED note, and add the harness. No migration, no runtime change, tsc clean. Please confirm the harness faithfully mirrors the production orchestration and the banner claim is justified.

## B. LIVE BUG to investigate — tenant `/n1/[token]` renders BLANK rent amounts

**Symptom:** `app.vacantless.com/n1/[token]` (the notice the TENANT receives) renders a blank "Your new rent will be ___", blank increase amount, and no guideline %. Current rent ($2,200) and the effective date (June 28, 2027) render fine. Reproduced 4x including fresh cache-buster URLs.

**Ruled out — stale deploy:** Vercel confirms `app.vacantless.com` = `44d1d5c` (current HEAD, READY). And the disk code renders correctly: feeding the exact stored snapshot to `renderN1Html`, AND running `deriveRentIncrease` with the `/n1` re-derive inputs, BOTH produce `$2,241.80 / $41.80 / 1.9%` (verified via `npx tsx`). The DB `rent_guidelines` table has `2027 = 1.90`, and the code constant `ONTARIO_GUIDELINE` also has `2027: 1.9`. So the live runtime is emitting output its own source should not.

**Strongest lead — client divergence in the guideline read:**
- WORK (user/session client): `serveN1` (`app/dashboard/tenancies/actions.ts` ~L832 `loadGuidelineLookup(supabase)`) froze a correct snapshot ($2,241.80); the tenancy-detail page and the operator N1 print route also use the user client and compute correctly.
- BLANK (service-role admin client): the public `app/n1/[token]/route.ts` (`loadGuidelineLookup(admin)`, L80) yields a null new rent. The rent-increase NUDGE CRON (`app/api/cron/rent-increase/route.ts`, `loadGuidelineLookup(admin)`) shares this path — **so the cron may also be emitting blank/wrong amounts; please audit it.**

**The core mystery:** `loadGuidelineLookup` (`lib/guideline-server.ts`) returns `(year) => map.get(year) ?? guidelineForYear(year)`. Even if the admin/service-role read of `rent_guidelines` returned zero rows, the code-constant fallback `guidelineForYear(2027) = 1.9` should still produce a non-null amount. It does not on the live admin path. Candidate explanations to check: (a) the service-role read behavior of `rent_guidelines` in prod; (b) whether the deployed bundle's `guidelineForYear` constant is actually current; (c) a Next.js/Vercel build-cache or data-cache subtlety specific to the admin path. Vercel runtime logs for `/n1` + the cron may show it.

**Planned fix direction (for context):** build the OFFICIAL LTB Form N1 rendered from the AUTHORITATIVE FROZEN SNAPSHOT cents (`n1_snapshot.newRentCents`), not a render-time re-derive — this both replaces the non-official custom facsimile (RTA s.116 requires the Board-approved form) and routes around this bug for the served copy. The cron path still needs the underlying root-cause fix.
