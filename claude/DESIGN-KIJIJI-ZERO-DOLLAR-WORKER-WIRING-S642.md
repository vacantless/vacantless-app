# DESIGN — Wire the proven Kijiji $0 recipe into the worker (S642)

**Date:** 2026-08-11 · **Session:** 642 · **Author:** Cowork (design; build goes to Codex per rule 33)
**Status:** design locked → Codex handoff = `CODEX-PROMPT-KIJIJI-ZERO-DOLLAR-WORKER-S642.md`

---

## 0. Why now

S641 proved, live via Chrome, that a Kijiji rental ad can be posted for **$0.00** (Ad ID
1741859802, 50 Glenrose Unit 4, on the Owner-eligible `admin@vacantless.com` account). That
closes the exact prerequisite the S635 Kijiji-autofire handoff was blocked on
(`CODEX-PROMPT-KIJIJI-AUTOFIRE-SLICE1-S635.md` §0: *"the worker reached Kijiji's package/upsell
wall and fail-closed at `needs_payment` instead of selecting the free option… If free-plan LIVE
cannot be proven, STOP."*).

This design turns the **manually-proven recipe** into the worker's free-plan code path
(`vacantless-worker/src/phase-b-submit.ts`: `attemptFreePlan` / `scrapePlans` / `isFreePlan`,
which already exist and tsc-compile per S636). It is the missing §0 of the S635 slice; the app
auto-fire wiring in that doc stays blocked behind `KIJIJI_AUTOFIRE_ENABLED` until this lands and
re-proves $0-live headlessly on the test org.

Scope of THIS design: worker only. No app code. No migration. Kijiji free only (no card, no
`needs_payment` path). Paid autofire (Viewit/RentFaster + `WORKER_PAY_ONFILE`) and the
expunge-relist scheduler are separate, out of scope here.

---

## 1. The root-cause correction that reshapes the design

Every prior "no free option" result was **account type**, not listing mechanics. Do NOT re-encode
any "fresh listing / new address / new unit unlocks free" logic — it is false and was the S636/
KI1029/KI1036 wrong turn.

- **Owner-eligible account** → RE post form shows a **"For Rent By: Owner"** radio (default
  selected) + a banner *"This category has a free posting limit of 1. You have 1 free ad
  remaining."* + a **$0.00** plan card. This is the only account class that can post free.
- **Professional account** (e.g. `thadmusco`, `rentals@agileonline.ca`) → the form shows only
  **"For Rent By: Professional — $29.95 per unit for 31 days"**, no Owner radio, no free card, a
  paid package force-selected. There is **no** free path on such an account, ever.

**Design consequence:** the worker's Kijiji account for free posting MUST be Owner-eligible
(`admin@vacantless.com` today). "Owner-eligible" is a **property of the account**, so it belongs in
the account/mapping config, and the worker must **assert it at runtime** (Owner radio present)
rather than assume it.

---

## 2. The proven $0 recipe (source of truth for the code path)

1. Post from an **Owner-eligible** account. Go through **Post → title → category** — do NOT
   direct-navigate `p-post-ad.html?...` (it can bounce to the homepage and drop the login).
2. Fill **all** required fields **before** the first submit (list in §4). Kijiji **pre-selects the
   paid Plus package** and, on any re-render/validation kickback, silently resets the plan back to
   Plus and the location back to the account default.
3. Scroll to the **"Almost Done! Pick a plan"** cards and **click Select on the $0.00 tier**
   (leftmost card, titled "Lite", "10 photos", fine print *"$29.95 from 2nd listing"*).
4. Selecting $0 makes the required **Ad Duration** section disappear, drops **Total Price to
   $0.00**, and flips the submit button **"Checkout & Post" → "Post Your Ad"**.
5. Post. Capture the live `/v-…/<adId>` URL.

### The honesty invariant (non-negotiable)

The worker may click the final Post **only when both** of these read true at that instant:

- `Total Price == $0.00`, AND
- submit button label `== "Post Your Ad"` (NOT "Checkout & Post").

If either is false → **fail-closed** (`needs_payment` / no-free-option). The worker never posts a
paid ad without the Phase-2 money-consent surface (`WORKER_PAY_ONFILE`), which does not exist yet.
This mirrors the existing fail-closed honesty contract for `needs_login`/`captcha`.

---

## 3. DOM handles captured (verified via Chrome across S83/S160/S641)

| Purpose | Handle | Notes |
|---|---|---|
| Active plan tier (hidden) | `input[name="featuresForm.featurePackage"]` | `PKG_BASIC` = Lite/leftmost card; `PKG_2` = Plus (the pre-selected upsell). **Do NOT treat PKG_BASIC as "free" by itself** — on a Professional account PKG_BASIC = $29.95. Free = PKG_BASIC **AND** Total $0.00. |
| Total price read | `document.body.innerText.match(/Total Price[^\n]*[\s\S]{0,40}/g)` | Canonical check for $0.00. |
| For-Rent-By radio | `postAdForm.*` (Struts-style form) — "Owner" vs "Professional" | Presence of an "Owner" option = account is Owner-eligible. Only-"Professional" = no free path. |
| Location (resets on kickback) | `input[name="postAdForm.mapAddress"]` | Silently reverts to account default on every validation kickback. |
| Description | textarea in `postAdForm` | **Set via the native prototype value setter + dispatch input/change** (`Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set`), else it silently reverts to empty on re-render. Radios/checkboxes set by real clicks are stable. |
| Submit button | label text: "Checkout & Post" (paid) vs "Post Your Ad" ($0) | Label flip is a primary $0 signal. |
| Free-slot banner | text "You have N free ad remaining" | N==0 or banner absent ⇒ no free slot right now (concurrency, §5). |

**Re-render / kickback trap (critical for the worker loop):** after ANY validation kickback the
plan tier resets to Plus (PKG_2) **and** location resets to the account default, with no UI signal.
So the correct order every cycle is: **fix the failing field → re-set location → re-select the $0
card → re-verify Total $0.00 + button "Post Your Ad" → only then Post.** Filling all required fields
up front (§4) minimizes kickbacks, but the re-assert step must exist regardless.

---

## 4. Required fields to fill before first submit

Title (≤64 chars; "Apt" not "Apartment"), Category, Unit Type, Bedrooms, Bathrooms, Agreement
Type, Move-In Date, Pet Friendly, **Size sqft (required)**, Smoking, Air Conditioning, Utilities,
**Parking Included (required)**, **Accessibility Features (required)**, Description, Location, Price,
Phone, Plan tier. Size/Parking/Accessibility only error on submit — set them up front or you eat a
kickback (which then resets plan + location).

---

## 5. Concurrency (account-slot model)

Kijiji free = **1 free listing per account at a time** (the $0 card's own fine print
"*$29.95 from 2nd listing*"). It is NOT a lifetime-per-property charge; a 2nd **concurrent** free
listing costs $29.95. So each Owner account holds exactly one free slot. When the free-slot banner
reads 0 remaining (or the $0 card can't reach Total $0.00), the worker fail-closes as
no-free-option for this account — it does NOT silently accept the $29.95 tier. (Freeing the slot by
expunge-relisting an existing ad is the S642-option-2 scheduler build, out of scope here.)

Implication for scaling beyond one concurrent free listing: pool of Owner accounts, one free slot
each. Not built here — flagged for the account-model backlog.

---

## 6. Function-level design (reconcile against actual source — Codex reads first)

The worker already has `scrapePlans`, `isFreePlan`, `attemptFreePlan` in `phase-b-submit.ts`
(S636). Codex must READ the current bodies + `mappings/kijiji.json` and adapt — the below is the
target behavior, not a blind rewrite.

**`scrapePlans()`** — return, per plan card: the visible **price** (parsed to a number; "$0.00" →
0), the **package code** (`featuresForm.featurePackage` value the card sets, e.g. PKG_BASIC), the
card title, and a handle to its **Select** control. Must read the actual rendered cards, not a
hardcoded list.

**`isFreePlan(plan)`** — true **iff the plan's parsed price === 0**. Do NOT gate on title ==
"Lite" or code == PKG_BASIC (Professional-account Lite is $29.95). Price-zero is the only truth.

**`attemptFreePlan()`** — the recipe as code:
1. Assert Owner-eligible (Owner radio present / selected). If only Professional is offered →
   return no-free-option (fail-closed), reason `professional_account_no_free`.
2. Optionally read the free-slot banner; if 0 remaining → no-free-option, reason `no_free_slot`.
3. `scrapePlans()` → pick the plan with `isFreePlan === true`; click its Select.
4. Re-assert after the resulting re-render: `featuresForm.featurePackage` is the free card's code,
   **Total Price == $0.00**, submit label == **"Post Your Ad"**, Ad Duration section gone.
5. If a prior field kickback happened, re-set location + description before re-asserting (both
   revert on kickback).
6. Only when the honesty invariant (§2) holds → click Post; capture the live `/v-…/<adId>` URL;
   return live + `external_url`.
7. Any assertion fail after N bounded retries → fail-closed `needs_payment`/no-free-option, leave
   the item `needs_operator` with a clear `error_code`/`error_message`. Never post at Total > 0.

**Config / mappings** (`mappings/kijiji.json`): capture the free-tier control selector, the
`featuresForm.featurePackage` free code, the Total-Price locator, the submit-button label states,
and the Owner-radio locator. Mark the account as Owner-eligible in the account/run config (the free
lane requires an Owner account; wire `WORKER_FREE_PLAN=true` / `submit:b:live:free` to this path per
S635 §0).

---

## 7. Acceptance (this worker slice)

1. On the test org (`8ea1da48-0cd2-45a4-bfba-023b31a67884`, never Agile `921f7c08`), an
   Owner-eligible Kijiji account, `WORKER_FREE_PLAN=true`: the worker posts **one real Kijiji ad
   live for $0.00**, captures the live `/v-…` `external_url`, and leaves the item `needs_operator`
   so the app's existing `completeConciergeItem` closes it. Delete the test ad after.
2. **Honesty:** with the account forced non-Owner (or the $0 card unreachable), the worker
   **fail-closes** (no-free-option / `needs_payment`) and posts **nothing** — never a $29.95 ad.
   Assert Total was never > 0 at any Post click.
3. Plan-reset resilience: after an induced validation kickback, the worker re-selects the $0 card +
   re-verifies Total $0.00 before Post (does not post on the reverted Plus tier).
4. `npx tsc --noEmit` clean on device. Unit cases for `isFreePlan` (price 0 → true; Professional
   Lite $29.95 → false; Plus → false) and for `attemptFreePlan`'s fail-closed branches.
5. `smoke:paid`/`smoke:all` run in the cloud (not device_bash — no network on the box VM).

---

## 8. What this unblocks

Landing this re-opens the S635 app slice: with the worker able to post Kijiji free headlessly,
`KIJIJI_AUTOFIRE_ENABLED` + the per-org `autopilot_publish_authorized` toggle can collapse the
two-click concierge path into the one-click publish for Kijiji. That app wiring is already specced
in `CODEX-PROMPT-KIJIJI-AUTOFIRE-SLICE1-S635.md` §1–§7 and is the natural next handoff once this
worker path is green.
