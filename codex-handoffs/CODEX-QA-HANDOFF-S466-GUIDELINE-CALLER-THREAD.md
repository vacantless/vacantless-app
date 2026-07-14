# Codex QA re-review handoff — S466 (folds your S462–S465 review)

Range to review: `6707726..44d1d5c` (one commit: **S466**).
App HEAD: `44d1d5c` — LIVE + Vercel READY, aliased app.vacantless.com.
No migration in this commit. Gates on HEAD: `tsc --noEmit` clean, `eslint` clean, guideline-lookup 7/0, rent-increase 38/0, rent-increase-sweep 18/0, renewal 42/0, n1-snapshot 19/0, billing 275/0.

## Context — your prior review was of S465, this folds it

Your last review verified `77e674d..6707726` (S461→S465) and returned two findings, both of which S466 folds:

- **P2** — S465's DB-backed guideline lookup (`loadGuidelineLookup`) was threaded only into `serveN1` and the tenancy detail page; the four remaining production rent-increase callers (Overview rollup, nudge cron, operator N1 print route, public N1 no-snapshot fallback) still called `deriveRentIncrease()` without it, so a future DB-only guideline year could split behavior.
- **P3** — `upsertRentGuidelineAction` wrote `admin console: <email>` into `rent_guidelines.source`, an authenticated-readable column, exposing the operator's email.

(Note: your review reported it reviewed the pasted brief because `CODEX-QA-HANDOFF-S462-S465.md` was in the project folder, not the repo `codex-handoffs/` dir. This handoff is now in `codex-handoffs/` so it resolves by filename.)

## What S466 changed (`git show 44d1d5c`)

Five files, +16/-3, no migration:

**P2 — thread `loadGuidelineLookup` into the four remaining callers.** Each now loads the lookup and passes `guideline` into `deriveRentIncrease`, matching serveN1/tenancy-detail:
- `app/dashboard/page.tsx` — `const overviewGuideline = await loadGuidelineLookup(supabase)` (L186); passed as `guideline: overviewGuideline` (L191).
- `app/api/cron/rent-increase/route.ts` — loads once globally `const guideline = await loadGuidelineLookup(admin)` (L125); passed into the per-tenancy `deriveRentIncrease` (L193).
- `app/dashboard/tenancies/[id]/n1/route.ts` — operator N1 print route: `const guideline = await loadGuidelineLookup(supabase)` (L72); passed (L74).
- `app/n1/[token]/route.ts` — public N1 **no-snapshot fallback path only**: `const guideline = await loadGuidelineLookup(admin)` (L80); passed (L85). The snapshot path is untouched — a served N1 still renders the frozen `n1_snapshot`.

`updateStripeRentAmount` deliberately still reads the frozen snapshot (not the live lookup) — the billed amount must equal the served amount. Unchanged in this commit.

**P3 — drop the admin email from the readable column.** `app/dashboard/admin/actions.ts` L110 now writes `source: "admin console"` (no email). No existing `rent_guidelines` row carried an email (the S465 seed used `source: "constant"`; only console upserts wrote the email, and none had run in prod).

## What to confirm

1. All four callers now derive the increase from the same DB-backed guideline as serveN1/tenancy-detail, so a DB-only future year cannot split behavior across surfaces.
2. The public N1 snapshot path is unchanged (served copies remain frozen); only the no-snapshot preview fallback gained the lookup.
3. `rent_guidelines.source` no longer carries operator identity on any write path.
4. No regression to the immutable-snapshot / per-cycle contracts (KI731/733/734) or the Stripe active-phase selection (S462, KI739).

If clean, the S462–S465 guideline-as-data lane is CLOSED. Still separately LIVE-UNVERIFIED vs Stripe sandbox: `selectActiveSchedulePhase` / `updateStripeRentAmount` (parked on a dedicated test Stripe account — not in this range).
