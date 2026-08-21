# CODEX PROMPT — Kijiji $0 free-plan worker path (S642)

**Repo:** `vacantless-worker` (standalone, on the box). **Branch from:** current `main`.
**No app repo change. No migration. Ship behind `WORKER_FREE_PLAN` (default off).**
This is the missing §0 of `CODEX-PROMPT-KIJIJI-AUTOFIRE-SLICE1-S635.md`: make the worker land a
Kijiji rental ad **live for $0.00** instead of stopping at `needs_payment` at the upsell wall.

Design of record: `DESIGN-KIJIJI-ZERO-DOLLAR-WORKER-WIRING-S642.md`. Read it, then this.

---

## 0. Read before editing (do NOT blind-rewrite)

- `src/phase-b-submit.ts` — existing `scrapePlans`, `isFreePlan`, `attemptFreePlan` (they compile
  today per S636). Read the current bodies and adapt them to the behavior below.
- `mappings/kijiji.json` — existing selector/field map. You will add the free-tier + assertion
  selectors here, not hardcode them in TS.
- The claim/complete contract in the worker (`claimApprovedJob`) and how a run item is left
  `needs_operator` with `external_url` / `error_code` — do not change that contract; this slice
  only changes *how the free plan is selected and asserted before Post*.

---

## 1. The correction that drives everything

The Kijiji free-vs-paid gate is the **account type (Owner vs Professional)**, NOT any
fresh-listing / new-address / new-unit mechanic. Delete/ignore any code or comment implying a fresh
listing "unlocks free."

- Owner-eligible account → "For Rent By: **Owner**" radio + "You have 1 free ad remaining" banner +
  a **$0.00** plan card.
- Professional account → only "For Rent By: Professional — $29.95/unit", **no free path ever**.

The worker's free lane therefore requires an **Owner-eligible account** and must **assert** that at
runtime, never assume it.

---

## 2. Behavior to implement

### 2a. `scrapePlans()`
Return an array of `{ price: number, packageCode: string, title: string, selectEl }` read from the
**actually rendered** "Almost Done! Pick a plan" cards. Parse `"$0.00"` → `0`, `"$29.95"` →
`29.95`. `packageCode` = the value the card sets on `input[name="featuresForm.featurePackage"]`
(observed: `PKG_BASIC` = leftmost "Lite" card, `PKG_2` = the pre-selected "Plus" upsell). Include a
handle to the card's **Select** control.

### 2b. `isFreePlan(plan)`
`return plan.price === 0;` — **price-zero is the only truth.** Do NOT gate on `title === "Lite"`
or `packageCode === "PKG_BASIC"`: on a Professional account the "Lite" / `PKG_BASIC` card is
$29.95, not free. (Add this as an explicit code comment so nobody re-introduces the title/code
gate.)

### 2c. `attemptFreePlan()` — the recipe as code
1. **Owner assert.** Confirm an "Owner" for-rent-by option is present/selected on the RE post form.
   If only "Professional" is offered → return `{ live:false, reason:"professional_account_no_free" }`
   (fail-closed, item stays `needs_operator`). Never proceed to a paid card.
2. **Free-slot check (optional but preferred).** Read the "You have N free ad remaining" banner. If
   N == 0 or the banner is absent → `{ live:false, reason:"no_free_slot" }`. (Freeing a slot via
   expunge-relist is a separate build; do not do it here.)
3. **Fill all required fields first** (see §3) to minimize validation kickbacks.
4. `scrapePlans()` → pick the plan with `isFreePlan(plan) === true` → click its Select.
5. **Re-assert after the re-render** (Kijiji resets the tier to Plus and location to account
   default on every re-render/kickback — see §4):
   - `input[name="featuresForm.featurePackage"].value` === the free card's code, AND
   - Total Price === `$0.00` via `document.body.innerText.match(/Total Price[^\n]*[\s\S]{0,40}/g)`,
     AND
   - the submit button label === **"Post Your Ad"** (NOT "Checkout & Post"), AND
   - the "Ad Duration" required section is gone.
6. If a field kickback occurred, **re-set location** (`input[name="postAdForm.mapAddress"]`) **and
   description** (native setter, §4) before re-asserting.
7. **Honesty gate — post only if `Total === $0.00` AND button === "Post Your Ad".** Then click Post,
   wait for the live `/v-…/<adId>` page, capture the URL → return `{ live:true, external_url }`.
8. Any assertion still failing after a **bounded** retry count (e.g. 3) → return
   `{ live:false, reason:"needs_payment" }` with a clear `error_message`. **Never click Post while
   Total > 0.**

---

## 3. Required fields (fill before first submit)
Title (≤64 chars, "Apt" not "Apartment"), Category, Unit Type, Bedrooms, Bathrooms, Agreement
Type, Move-In Date, Pet Friendly, **Size sqft (required)**, Smoking, Air Conditioning, Utilities,
**Parking Included (required)**, **Accessibility Features (required)**, Description, Location, Price,
Phone, Plan tier. Size / Parking / Accessibility only error on submit; leaving them blank forces a
kickback that then resets plan + location.

---

## 4. Traps that WILL break a naive implementation
- **Plan resets to Plus (PKG_2) on every re-render / URL transition / validation kickback**, silently.
  Always re-select the $0 card and re-verify Total after any kickback, immediately before Post.
- **Location (`postAdForm.mapAddress`) resets to the account default** on every validation kickback.
  Re-set it after any kickback before re-asserting.
- **Description textarea silently reverts to empty** unless set with the native prototype value
  setter + dispatched input/change:
  `const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; set.call(ta, text); ta.dispatchEvent(new Event('input',{bubbles:true})); ta.dispatchEvent(new Event('change',{bubbles:true}));`
  Radios/checkboxes set by real clicks are stable.
- **Do NOT direct-navigate `p-post-ad.html?...`** — it can bounce to the homepage and drop the
  login session. Navigate **Post → title → category**.
- **`file_upload` reads cloud/worker paths, not device paths** (relevant only when this runs under a
  driver that stages photos; keep the existing photo-upload path).

---

## 5. Config / mappings
In `mappings/kijiji.json` add: the free-tier Select selector, the free `featuresForm.featurePackage`
code, the Total-Price locator, the submit-button label strings ("Post Your Ad" / "Checkout &
Post"), the Owner for-rent-by radio locator, and the free-slot banner locator. Mark the run/account
config as Owner-eligible for the free lane and wire `WORKER_FREE_PLAN=true` (or a
`submit:b:live:free` script) to route into `attemptFreePlan`. Flag off ⇒ current behavior byte-for-
byte (still fail-closes at `needs_payment`).

---

## 6. Acceptance
1. Test org `8ea1da48-0cd2-45a4-bfba-023b31a67884` (**never** Agile `921f7c08`), an Owner-eligible
   Kijiji account, `WORKER_FREE_PLAN=true`: worker posts **one real ad live for $0.00**, captures
   the live `/v-…` `external_url`, leaves the item `needs_operator` for `completeConciergeItem`.
   Delete the test ad after.
2. **Honesty:** force non-Owner (or make the $0 card unreachable) ⇒ worker fail-closes, posts
   nothing, and it is provable that Total was never > 0 at any Post attempt.
3. Kickback resilience: after an induced validation kickback the worker re-selects the $0 card +
   re-verifies Total $0.00 before Post (never posts on the reverted Plus tier).
4. `npx tsc --noEmit` clean on device. Unit tests: `isFreePlan` (price 0 → true; Lite $29.95 →
   false; Plus → false); `attemptFreePlan` fail-closed branches (`professional_account_no_free`,
   `no_free_slot`, `needs_payment`).
5. `smoke:paid` / `smoke:all` run in the cloud (not device_bash — the box VM has no network).

## 7. Out of scope
App auto-fire wiring (that's S635 §1–§7, unblocked *after* this lands), expunge-relist / expiry
scheduler (S642 option 2), paid autofire + `WORKER_PAY_ONFILE` (Phase 2), multi-account free-slot
pooling.

_Standing: builds go to Codex; gh not on the Mac (merge via GitHub web/Chrome); no em dashes in any
user-facing copy; the Owner-eligible Kijiji account is `admin@vacantless.com`._
