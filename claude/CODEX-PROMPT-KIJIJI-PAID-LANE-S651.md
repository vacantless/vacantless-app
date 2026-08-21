# CODEX PROMPT — Kijiji PAID lane (Professional plan + pay-on-file) — S651

**Repo:** `vacantless-worker` (the box worker, separate deployable from `vacantless-app`).
**Branch off `main` (worker main b34a387).** One feature branch, e.g. `codex/s651-kijiji-paid-lane`.
**Standing rules:** no em dashes anywhere. Money moves in this lane — every guardrail below is load-bearing; do not "simplify" one away. Fail CLOSED on every ambiguity.

---

## 0. Why this build exists (read first)

Agile's Kijiji account is a **PAID Professional account with no $0 free plan** (Noam confirmed, S650). Proven live on the box: the headless pipeline warms Agile's Kijiji session, claims an approved item, fills the whole Kijiji create wizard, clicks Post, and lands on the plan wall — where `ensureOwnerEligible` returns `professional_account_no_free` (only the Professional for-rent-by option exists, no Owner option), so the FREE lane fail-safes to `needs_operator` with `audit_message` "this account only offers Professional paid posting. No paid plan was selected." Nothing posted, $0 charged.

Consequence: **the FREE Kijiji lane structurally cannot post Agile.** The existing paid runner (`phase-b-submit-paid.ts`) covers only Viewit and RentFaster — it is a different, multi-step wizard runner and does NOT drive Kijiji. So Agile's Kijiji is the one channel still stuck on the guided (post-it-yourself) route. Noam wants it **headless/instant like every other channel.**

This build teaches the **existing Kijiji runner** (`phase-b-submit.ts`) to, at the plan wall, select the **base Professional (paid) package** and complete checkout with Kijiji's **own saved payment method** — behind `WORKER_PAY_ONFILE`, per-post consent, with a hard price ceiling — modeled on the pay-on-file semantics already proven in `phase-b-submit-paid.ts` + `paid-submit-logic.ts`.

**Architecture decision (do it this way):** Build the paid path **inside `phase-b-submit.ts`**, as a sibling to `attemptFreePlan`, reusing the Kijiji wizard/plan-scrape machinery that already exists there (`scrapePlans`, `readTotalPrice`, `selectedPackageCode`, `buttonByLabel`, `classifyPostPage`, the mapping's `_meta.freePlan` selectors). Do NOT try to route Kijiji through `runPaidSubmit`/`PaidChannelSpec` — that shared runner is a generic multi-step `nextNames` wizard and would throw away all the hardened, bespoke Kijiji handling (geocoder, in-page plan grid, delete/repost, photo dynamic input). Keep one source of truth for the Kijiji wizard.

**Consent + money model (the invariant that never bends):** the landlord's in-app "Approve & publish" tap (`operator_submit_approved_at`, which `claimApprovedJob` reads) is the per-post consent — approving an item is approving **that one paid post**. The worker NEVER types a card number. It only clicks Kijiji's own "pay with the card already on file / place order / confirm & pay" control ONCE. If the checkout offers only a raw card-entry form (no saved method), the worker STOPS at `needs_payment` and hands off — it never fills a card. And it never clicks pay when the read Total exceeds the configured ceiling.

---

## 1. The tri-state (mirror `phase-b-submit-paid.ts` exactly)

Three modes, gated by two existing env flags plus one new flag and one new ceiling:

- **DARK** (`submit:b:dark`, no flags): unchanged. Fill wizard, stop before Post. No post, no pay.
- **LIVE, no pay** (`submit:b:live`, `WORKER_SUBMIT_LIVE=true`): unchanged. Click Post once, classify, STOP at whatever wall. On Agile this lands `needs_payment` at the plan wall. No package selected, no pay.
- **LIVE + PAY** (`submit:b:live:pay`, `WORKER_SUBMIT_LIVE=true WORKER_PAY_ONFILE=true`): NEW. At the `needs_payment` plan wall, run `attemptPaidPlan` (below): select the base Professional package, assert the Total is at-or-below the ceiling, click "Checkout & Post", reach Kijiji checkout, then pay-on-file with the saved method. Classify → `live` (ad detail page) or `needs_payment` (stopped, no card typed).

Crucial detail from the free lane you are mirroring: `WORKER_FREE_PLAN` gates `attemptFreePlan` (`if (freePlanCfg && outcome === "needs_payment") { attemptFreePlan(...) }` at ~L2151). The paid path is the **mutually-exclusive sibling**: when `WORKER_PAY_ONFILE` is on, run `attemptPaidPlan` instead of `attemptFreePlan`. Never run both in one pass. If BOTH `WORKER_FREE_PLAN` and `WORKER_PAY_ONFILE` are somehow set, prefer the paid path only when the account is Professional (free lane would fail `professional_account_no_free` anyway); otherwise free. Log which lane ran.

`WORKER_PAY_ONFILE` is read directly from `process.env` (same as `phase-b-submit-paid.ts` L114) — you do NOT need to thread it through `config.ts`. The new ceiling `WORKER_PAY_MAX_CENTS` is also read at module scope with a conservative default.

---

## 2. New file: `src/paid-plan-logic.ts` (pure, unit-testable, no IO)

Mirror `submit-logic.ts` / `paid-submit-logic.ts` — pure decisions only, so they test without a browser.

```ts
// The single paid package we will authorize. "base" = the cheapest paid plan on
// the wall (a plain single-ad Professional post), never a featured/promoted/
// bundle upsell. Price-anchored, not title-anchored (titles/codes are unstable).
export type PaidPlanCandidate = { price: number; title?: string; packageCode?: string };

// Pick the CHEAPEST strictly-paid plan (price > 0). Returns index or -1.
// -1 means "no authorizable paid plan found" -> stop at needs_payment, never guess.
export function pickBasePaidPlanIndex(plans: PaidPlanCandidate[]): number { /* ... */ }

// The money gate. Authorize the click ONLY when:
//   payOnFileEnabled AND savedMethodPresent AND priceCents != null
//   AND priceCents > 0 AND priceCents <= maxCents.
// A raw card-entry form is NEVER sufficient (savedMethodPresent must be true).
// Returns "pay_onfile" | "needs_payment" | "over_ceiling".
export type PaidGateInputs = {
  payOnFileEnabled: boolean;
  savedMethodPresent: boolean;
  cardEntryPresent: boolean;   // diagnostics only, never forces pay
  priceCents: number | null;
  maxCents: number;
};
export function decidePaidGate(i: PaidGateInputs): "pay_onfile" | "needs_payment" | "over_ceiling" { /* ... */ }
```

Reuse `parsePriceToCents` / `parsePlanPrice` from `submit-logic.ts` (do not re-implement price parsing).

Add `paidLandingForKijiji(...)` (or extend `landingFor` in `submit-logic.ts` with new outcomes — your call, keep it pure). New terminal outcomes and their DB landings:

- `live` + captured url → `publish_status: needs_operator`, `clearApproval: true`, `external_url: <url>`, audit "Worker completed the paid Kijiji post (paid with the on-file method, $X.XX); URL captured: <url>. Confirm on the desk to mark live." **Consume the approval so it can never auto-re-charge.**
- `needs_payment` (reached checkout, stopped, no card typed) → `publish_status: needs_payment`, `clearApproval: true` (Post/Checkout was clicked), audit "Worker reached the Kijiji checkout and stopped (no saved method available or card entry only; no card entered, no payment made). Approve & pay in-app or finish by hand."
- `over_ceiling` → `publish_status: needs_operator`, `clearApproval: true`, audit "Worker stopped: the Kijiji Total ($X.XX) exceeded the authorized ceiling ($Y.YY). No payment made. Review the package/price and raise the ceiling deliberately if correct." (This is the mis-scrape / surprise-price backstop.)
- `paid_plan_not_found` (no strictly-paid base package scraped) → `needs_operator`, audit "Worker could not identify a base Professional package to authorize. No payment made."
- Reuse existing `needs_login` / `captcha` / default landings unchanged.

Every "consume" path sets `clearApproval: true` so a spent approval can never silently re-fire a second real charge — this is the money-safety analogue of the free lane's clearApproval.

---

## 3. `src/phase-b-submit.ts` — the runner changes

### 3a. Module-scope flags
```ts
const PAY_ONFILE = (process.env.WORKER_PAY_ONFILE ?? "").toLowerCase() === "true";
// Hard ceiling for a single paid post, in cents. Conservative default; override per run.
const PAY_MAX_CENTS = Number(process.env.WORKER_PAY_MAX_CENTS ?? 5000); // $50.00 default
```

### 3b. New `readPaidPlanConfig` (or extend `readFreePlanConfig`)
Read a new `_meta.paidPlan` mapping block (section 4). It carries the saved-method button names, the checkout/live/card selectors, and an optional explicit `basePackageCode` (if set, prefer the plan whose `featurePackage` value equals it; else fall back to `pickBasePaidPlanIndex` = cheapest paid). Fail loud if the block is missing when `PAY_ONFILE` is on.

### 3c. New `ensureProfessionalEligible(page, cfg)`
The inverse of `ensureOwnerEligible`. Confirm the account is genuinely a Professional paid account before authorizing money: `professionalRadioSelector` present (proCount > 0). If the Owner option is present (this is actually a free-eligible account), return `{ ok:false, reason:"owner_account_use_free_lane" }` and DO NOT pay — a free-eligible account must never be charged. Ensure the Professional radio is selected (it usually is by default on such accounts).

### 3d. New `attemptPaidPlan(page, cfg, values): Promise<PaidPlanResult>`
Model on `attemptFreePlan` / `prepareFreePlanForPost`, but:
1. `ensureProfessionalEligible` — else fail-safe with the reason (no pay).
2. `scrapePlans(page, cfg)` — reuse it. Filter to strictly-paid (price > 0). Select the base package: explicit `basePackageCode` match if configured, else `pickBasePaidPlanIndex` (cheapest paid). If none → `paid_plan_not_found`.
3. Select that plan card. Re-assert with `selectedPackageCode` that the selected package equals the intended one, and re-read `readTotalPrice`. Confirm NO featured/promo add-ons toggled — the Total must equal the base package price (assert `total == selectedPackagePrice`; if a bundle/feature inflated it, treat as `over_ceiling`-style stop). This is the "exactly one authorized charge, nothing extra" assertion.
4. `decidePaidGate({ payOnFileEnabled: PAY_ONFILE, savedMethodPresent, cardEntryPresent, priceCents, maxCents: PAY_MAX_CENTS })`.
   - `over_ceiling` / `needs_payment` / `paid_plan_not_found` → return without clicking pay.
   - `pay_onfile` → click "Checkout & Post" (`paidSubmitButtonLabel`, already in mapping = "Checkout & Post") ONCE → reach Kijiji checkout → find the saved-method control via `savedMethodNames` (`firstButton` pattern) → click it ONCE → `classifyPostPage`.
5. NEVER touch `cardEntry` (`selectors.cardEntry`) — read its presence for diagnostics only.
6. Screenshot before the Checkout click, after it (the checkout page), and after the pay click. Record the scraped Total, the selected packageCode, `savedMethodPresent`, `cardEntryPresent`, and the gate decision in the attempt metadata.

**Every retry re-asserts the selected package + Total + saved-method before the irreversible pay click** (same discipline as the free lane's per-retry re-assert before Post).

### 3e. Wire into the main run() branch (~L2151)
Where today it does `if (freePlanCfg && outcome === "needs_payment") attemptFreePlan(...)`, add the sibling:
```ts
if (PAY_ONFILE && paidPlanCfg && outcome === "needs_payment") {
  const paid = await attemptPaidPlan(page, paidPlanCfg, fillValues);
  // set outcome/liveUrl/metadata from paid result; landing via paidLandingForKijiji
} else if (freePlanCfg && outcome === "needs_payment") {
  // existing free path, unchanged
}
```
Keep the free path byte-for-byte unchanged when `PAY_ONFILE` is off. Extend the two `print({...})` summaries with `pay_onfile_enabled`, `pay_max_cents`, `paid_plan_selected`, `paid_total`, `saved_method_present`, `paid_gate_decision`, `pay_clicked`.

---

## 4. `mappings/kijiji.json` — new `_meta.paidPlan` block

The `_meta.freePlan` block already has what the wizard needs; add a sibling `paidPlan` block for the paid-specific bits. Reuse `professionalRadioSelector`, `planCardSelector`, `featurePackageSelector`, `totalPricePattern`, `paidSubmitButtonLabel` ("Checkout & Post") from `freePlan` (read them from there, or copy — your call; single source preferred). New keys:

```jsonc
"paidPlan": {
  "basePackageCode": "",                 // optional; empty = pick cheapest paid. Fill after recon.
  "checkoutSelector": "...",             // proves we're on the checkout/billing surface (RECON)
  "savedMethodNames": [                  // Kijiji's OWN pay-with-on-file control (RECON on Agile)
    "pay with (saved|card on file|existing)", "place order",
    "confirm (and|&) pay", "pay \\$?\\d", "complete (payment|checkout|purchase)", "^\\s*pay now\\s*$"
  ],
  "cardEntrySelector": "iframe[src*=\"stripe\" i], iframe[title*=\"card\" i], input[name*=\"card\" i], input[id*=\"card\" i]",
  "liveUrlPattern": "kijiji\\.ca/v-|[?&]adId=\\d+"   // reuse LIVE_URL_RE
}
```
The `savedMethodNames`, `checkoutSelector`, and the real `basePackageCode` are **RECON-PENDING** — confirm them on Agile's live checkout during the DARK proof (section 6). Every one is a mapping value = a one-line fix, not a code change.

---

## 5. `package.json` — new script
Mirror `submit:v:live:pay`:
```
"submit:b:live:pay": "WORKER_SUBMIT_LIVE=true WORKER_PAY_ONFILE=true tsx src/phase-b-submit.ts"
```
(Optionally a dark-recon variant `submit:b:recon:pay` = `WORKER_SUBMIT_LIVE=true WORKER_PAY_ONFILE=false WORKER_FORM_DUMP=true` to reach the wall and dump the checkout DOM without paying — but the existing `submit:b:live` already reaches the wall and stops, so this is optional.)

---

## 6. Tests (required, all green before handback)

New `scripts/test-paid-plan-logic.ts` (mirror `test-submit-logic` style), covering `pickBasePaidPlanIndex`, `decidePaidGate`, `paidLandingForKijiji`:
- cheapest-paid chosen; free ($0) plans excluded from paid pick; no-paid → -1 / `paid_plan_not_found`.
- gate: pays ONLY when enabled + savedMethodPresent + 0 < price <= ceiling. Over ceiling → `over_ceiling`. Card-entry-only (no saved method) → `needs_payment`. Price null → `needs_payment`. Disabled → `needs_payment`.
- landing: `live` consumes approval + captures url; every stop consumes approval (Post clicked) but posts/charges nothing; `owner_account_use_free_lane` never pays.
- Boundary: price == ceiling pays; price == ceiling + 1 cent does not.
Keep the existing Kijiji suites green (free lane untouched). `tsc --noEmit` clean. `git apply --check` clean on pristine b34a387.

---

## 7. Proof plan (how Noam runs it — put in the PR description)

There is **no disposable/free Professional Kijiji account** to rehearse on — Agile's is the only Professional account, and the test org's personal Kijiji is a FREE account that never shows the paid plan wall. So the "prove DARK on a disposable surface" rule is satisfied by **reaching the checkout and STOPPING on Agile's own account, which costs $0**:

1. **DARK-at-checkout recon (zero charge):** box on Agile prod (`TARGET_ORG_ID=Agile`, `ALLOW_AGILE_PROD=true`), Agile Kijiji session warmed. Run `submit:b:live` (LIVE, no pay) on an approved Agile item → confirm it lands `needs_payment` at the plan wall as today. Then run with `WORKER_PAY_ONFILE=true` **but `WORKER_PAY_MAX_CENTS=0`** (ceiling 0 → gate returns `over_ceiling` → never clicks pay): this exercises `ensureProfessionalEligible` + `scrapePlans` + base-package select + Total read + checkout-reach + saved-method detection, screenshots every step, and STOPS with $0. Read the screenshots/metadata to fill the RECON-PENDING mapping values (`savedMethodNames`, `checkoutSelector`, `basePackageCode`, real base price).
2. **One supervised LIVE pay, on Noam's explicit GO only:** set `WORKER_PAY_MAX_CENTS` to just above the confirmed base price, `submit:b:live:pay`, one approved Agile item. Watch it select the base package, click "Checkout & Post", pay with the saved method once, land on the live ad, capture the url, consume the approval. Verify in Chrome the ad is live and exactly one charge at the base price hit the account.
3. Fail-safe check: at any point a missing saved method, an over-ceiling Total, a login wall, or a captcha must leave the item at `needs_payment`/`needs_operator` with backup intact, approval-consumed, **$0 beyond the one authorized base post**, nothing orphaned.

Do NOT run step 2 before step 1 is clean and the mapping values are confirmed. Never pay on file before a supervised dry run (same rule the Viewit/RentFaster lanes carry).

---

## 8. Acceptance criteria
- Free Kijiji lane byte-for-byte unchanged when `WORKER_PAY_ONFILE` is off (diff the free path).
- Paid path only ever authorizes ONE charge, at the base Professional package price, at or below `WORKER_PAY_MAX_CENTS`, via the site's saved method, never a typed card, only on a confirmed Professional account, only with a live-approved item.
- Every non-live outcome consumes the approval and leaves $0-beyond-authorized, backup intact, no orphan.
- All new + existing tests green; `tsc --noEmit` clean; applies clean on pristine worker main b34a387.
- No em dashes in code comments or docs.

Report back: the branch name, the diff summary (files touched), test results, and the exact RECON-PENDING mapping keys still needing live values so Noam can fill them from the step-1 screenshots.
