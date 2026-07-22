# Codex build ticket — Re-place the leasing-loop features into Growth (copy-only)

**Session:** S491 · **Author:** Cowork (Opus), 2026-07-15 · **App HEAD at write time:** 145a08f
**Type:** Customer-facing copy only. **No entitlement change. No behavior change. No migration. No new server surface.**
**Gates:** `npx tsx scripts/test-billing.ts` · `npx tsx scripts/test-*` (any that snapshot tier copy) · `tsc --noEmit` · `next lint` · `next build`.

---

## 1. Why

Post-viewing follow-up, lead nurture, and showing clustering are part of the **leasing loop** — the exact "fill the vacancy" value Growth ($99) is anchored on — but they are not represented in Growth's marketing. Two findings from the S491 review:

1. **These features are NOT plan-gated.** `lib/billing.ts` `PLAN_FEATURES` (the enforced entitlement list) does not contain follow-up, nurture, round-robin, or clustering. They are ungated org booleans (`feedback_enabled`, `nurture_enabled`, `clustering_enabled`, `auto_assign_agents`) available to any tier. So "which tier they belong to" is purely a **pricing-page copy** decision today — there is nothing to gate or ungate.
2. **Post-viewing follow-up appears on NO tier card** (not Growth, not Premium) in either surface, despite being actively used (the Agile dogfood has sent 16 follow-ups). It is invisible to buyers. Nurture and clustering are likewise unlisted, so Growth is under-sold.

**The fix:** list post-viewing follow-up + lead nurture + showing clustering as **Growth** features on both customer-facing surfaces. Premium keeps "Everything in Growth" so it inherits them; round-robin ("Shares new inquiries evenly across your team") stays a Premium differentiator (it's the multi-agent case). Nothing is removed from Premium.

**Explicitly OUT of scope (do not do):** do not add entitlement gating for these features. Gating would be a behavior change that could turn a feature OFF for an existing org (e.g. a Free/pilot org that currently has `feedback_enabled`). This ticket only edits display strings.

---

## 2. Edit A — `vacantless-app/lib/billing.ts` (drives the in-app billing cards)

The billing page (`app/dashboard/billing/page.tsx:369`) maps `tier.features` directly, so editing `TIERS.growth.features` is the only change needed for the in-app card. **Premium is unchanged.**

**Current (lines 455–462):**
```ts
    features: [
      "Unlimited active listings",
      "Online rent collection (Stripe / Rotessa)",
      "Renter pre-screening questions",
      "Tenant + renter messaging by email and text",
      "Tenancy records and payment ledger",
      "Year-end tax / rent export",
    ],
```

**New:**
```ts
    features: [
      "Unlimited active listings",
      "Online rent collection (Stripe / Rotessa)",
      "Renter pre-screening questions",
      "Tenant + renter messaging by email and text",
      "Automated lead nurture and post-viewing follow-up",
      "Grouped viewing scheduling (back-to-back showings)",
      "Tenancy records and payment ledger",
      "Year-end tax / rent export",
    ],
```
(Two bullets added, positioned right after messaging — the leasing-loop cluster. `TIERS.premium.features` stays exactly as-is; "Everything in Growth" already carries the inheritance.)

---

## 3. Edit B — `vacantless-app/app/page.tsx` (homepage `PLANS` array)

The homepage keeps its own curated copy. Keep it tight — add ONE leasing-loop bullet (the strongest message) rather than mirroring all of Edit A.

**Current (lines 1008–1014), Growth `includes`:**
```ts
    includes: [
      "Unlimited live rentals",
      "Automatic rent collection (Stripe / Rotessa)",
      "Tenant records and payment ledger",
      "Renter screening, plus email and text",
      "Listing distribution and year-end tax export",
    ],
```

**New:**
```ts
    includes: [
      "Unlimited live rentals",
      "Automatic rent collection (Stripe / Rotessa)",
      "Tenant records and payment ledger",
      "Renter screening, plus email and text",
      "Automated lead nurture and post-viewing follow-up",
      "Listing distribution and year-end tax export",
    ],
```
(One bullet added. Premium `includes` at 1025–1030 unchanged.)

---

## 4. Copy notes (wording is adjustable — Noam's call)

- "Automated lead nurture and post-viewing follow-up" = the `nurture_enabled` sequences + the `feedback_enabled` "how did the viewing go?" request. If preferred as two bullets on the billing card, split into "Automated lead nurture" and "Post-viewing follow-up".
- "Grouped viewing scheduling (back-to-back showings)" = `clustering_enabled` (showing blocks). Alt phrasings: "Smart showing scheduling", "Back-to-back viewing blocks".
- Do not add clustering to the homepage unless desired — the homepage is deliberately more curated than the in-app card.

---

## 5. Acceptance criteria

1. In-app billing page (`/dashboard/billing`): Growth card shows the two new bullets; Premium card unchanged; Free unchanged.
2. Homepage pricing section: Growth shows the new nurture/follow-up bullet; Premium unchanged.
3. `tsc --noEmit` clean; `next lint` clean (no new warnings); `next build` passes.
4. `npx tsx scripts/test-billing.ts` passes. If any test snapshots the exact `features`/`includes` arrays, update the snapshot to match; if none do, no test change.
5. Grep confirms `PLAN_FEATURES` / `PLAN_ENTITLEMENTS` are untouched — this ticket changes only display strings.

---

## 6. Follow-on (NOT this ticket — flagged for Noam)

If Vacantless later wants these to be *true* Growth+ differentiators (so a Free org can't use them), that needs real entitlement work: add `post_viewing_followup` / `lead_nurture` / `showing_clustering` to `PlanFeature` + `PLAN_ENTITLEMENTS`, enforce server-side at each send/assign site, and audit existing orgs so no live org loses a feature it currently uses (Agile has all four ON). That is a behavior change with a migration-review cost and is deliberately deferred.
