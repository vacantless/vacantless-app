# Codex prompt — Aaliyah's Agile fixes (S629)

**Date:** 2026-08-07 · **Author:** Cowork (grounded against the connected-clone code on the Mac) · **Status:** LANE A APPLIED-AND-HELD · LANE B READY FOR CODEX
**Repo:** `.../Agile Lead to Lease Engine/vacantless-app` · working checkout `codex/s626-publish-all-channels` @ `db730cd`.
**BASE = current prod commit `db730cd` (your current HEAD).** ⚠️ `main` is at `1d3d733`, a *different* commit than prod — do **NOT** branch Lane B off `main` or you'll build on a stale base. Cut Lane B from the current HEAD (where held Lane A already sits), or confirm which ref is actually deployed before choosing a base.
**Origin:** real request from Aaliyah (Agile leasing agent), 2026-08-07:
1. Couldn't find where to enter the weekly showing schedule. **RESOLVED** — she reached it via the empty-state ("no available times") link and is unblocked. Lane A below is now *optional hardening*, not an active fix.
2. Feature ask: require a phone number before a renter submits an inquiry/booking (she keeps getting leads with no number and must lean on "nudge renter"). **This is the real deliverable = Lane B.**

**Standing constraints (S595):** additive migrations only; new user-facing behavior ships DARK (Lane B rides an org column defaulting `false`); esbuild/tsx-check every edited TSX; add/extend a test script; **Noam reviews + pushes** (do not deploy). Cowork cannot run `next build` here.

---

## LANE A — persistent "Set viewing times" link on the Viewings hub — ✅ ALREADY APPLIED-AND-HELD

**Status:** Cowork applied this edit directly in the clone (uncommitted, held). Review with `git diff app/dashboard/showings/page.tsx`. esbuild-clean (exit 0). One file, no migration, no behavior/query change.

**What it does:** the ESL nav consolidation (S600/S601) folded the old standalone "Viewing Times" tab into the "Viewings" hub (`/dashboard/showings`); the schedule editor still lives at `/dashboard/availability` (title "Set viewing times") but the Viewings page only linked to it from an empty-state CTA. The edit adds an always-visible **"Set viewing times →"** link in the Viewings page header (sibling to the gated "Manage showing agents →" link) so operators *with* existing showings aren't dead-ended.

**Codex/Noam action:** just review + commit with Lane B (or drop it by `git checkout app/dashboard/showings/page.tsx` — Aaliyah is already unblocked). Nothing to build here beyond esbuild.

---

## LANE B — org-scoped "require a phone number" toggle (additive migration, ships dark)

Requiring phone globally would hit every client org and add conversion friction, so it's an **org-scoped opt-in** (default off), flipped on for Agile only. Phone is one shared field, so requiring it covers both the booking and plain-inquiry paths (Aaliyah's "either an inquiry or booking").

Files: **new migration `0210`**, `app/r/[propertyId]/page.tsx`, `app/r/[propertyId]/inquiry-form.tsx`, `app/r/[propertyId]/actions.ts`, `app/dashboard/settings/page.tsx` (+ `app/dashboard/settings/actions.ts`), + a test script.

### B0. Warm-verify first (grounded anchors from this session)
- **The renter page reads listing data from the `get_public_listing` RPC**, NOT a raw org select. `app/r/[propertyId]/page.tsx:158` → `supabase.rpc("get_public_listing", …)`; the returned `l` payload carries the existing built-in-ask flags (`screening_ask_income/movein/pets/occupants`, typed at `page.tsx:75-78`, wired into `<InquiryForm>` at `page.tsx:731-734`). **So the new flag must be surfaced through `get_public_listing`, mirroring exactly how `screening_ask_*` are returned.** Codex: pull the current `get_public_listing` definition (from the latest migration that CREATE-OR-REPLACEs it, or via Supabase MCP) and add one field — do not rewrite its logic.
- `app/r/[propertyId]/actions.ts` → `submitLead`: phone parsed at `:609` (`String(formData.get("phone") ?? "").trim()`), passed as `p_phone` at `:657`, RPC `submit_public_lead` at `:671`, error redirect `?error=1` at `:674`, success `?submitted=1` at `:679`. The form reads `showError={Boolean(searchParams.error)}`. **`submitLead` only has `propertyId` + `formData`** — it does not call `get_public_listing` — so it must resolve the org's `inquiry_require_phone` itself (a lightweight select by property→org; confirm the existing property→org resolution used elsewhere in this file). `rebookSavedLead` (`:815`) already requires email OR phone (`:822`); leave its logic unless we want phone specifically there too (out of scope — the primary form is `submitLead`).
- `app/dashboard/settings/page.tsx` + `app/dashboard/settings/actions.ts` — the org Settings surface + save action where `public_contact_phone` / screening settings are edited. Add the toggle to the settings section that governs the inquiry form (near the built-in "what we ask" screening toggles is the most coherent home). Respect the same role guard; do not widen who can edit settings. Follow the boolean-column settings pattern (S595 Lane B `compliance_calendar_enabled`).
- `supabase/migrations/` — highest is **`0209`**; use **`0210`**. Confirm no existing `inquiry_require_phone` column.

### B1. Migration `0210_inquiry_require_phone.sql` (ADDITIVE)
```sql
alter table organizations
  add column if not exists inquiry_require_phone boolean not null default false;
```
Then **`create or replace function get_public_listing(...)`** to add `inquiry_require_phone` to its returned JSON/row (copy the current definition; add the one field alongside the `screening_ask_*` fields; keep everything else byte-identical). No RLS change (org-scoped column). Grants: if `organizations` uses column-scoped service_role grants (S522 precedent), grant SELECT on the new column; else none — state which.

### B2. `page.tsx` — surface the flag
Add `inquiry_require_phone?: boolean;` to the `PublicListing` type (beside `screening_ask_*` at ~`:78`). Pass into the form at `:740`:
```tsx
              petFriendly={l.pet_friendly}
              requirePhone={l.inquiry_require_phone ?? false}
```

### B3. `inquiry-form.tsx` — phone conditionally required (exact diff)
Add `requirePhone: boolean;` to `InquiryFormProps` (after `petFriendly: boolean;`) and to the destructured params. Replace the phone-field block (currently labeled "(optional)", no `required`):
```tsx
            <div>
              <label htmlFor="r_phone" className="mb-1 block text-sm font-medium text-gray-700">
                Phone{" "}
                {requirePhone ? (
                  <span className="font-normal text-gray-400">(required)</span>
                ) : (
                  <span className="font-normal text-gray-400">(optional)</span>
                )}
              </label>
              <input
                id="r_phone"
                name="phone"
                type="tel"
                required={requirePhone}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs text-gray-400">
                {requirePhone
                  ? "We'll text you about this viewing (confirmation and reminders). Reply STOP anytime to opt out."
                  : "If you share your number we may text you about this viewing (such as a confirmation and reminders). Reply STOP anytime to opt out."}
              </span>
            </div>
```
**Hidden-required safety:** the phone field is in the "Your details" fieldset, revealed (`detailsRevealed`) before the Confirm button appears (`prepareRevealed` needs name+email, same fieldset). So a `required` phone is always visible when submit is reachable — no "invalid form control is not focusable" trap. Do not move the field. No-JS: native `required` still enforces.

### B4. `submitLead` server guard (defense-in-depth; tamper-proof)
In `actions.ts`, after phone is parsed (`:609`), resolve the org's `inquiry_require_phone` (lightweight select by property→org). If `true` and `phone` is blank, **redirect to `?error=1`** (reuse the existing error path at `:674`; optionally `?error=phone` + a targeted message if you also thread a reason into `showError`) and do NOT call `submit_public_lead`. Never throw; keep the existing best-effort posture.

### B5. Test script
Add/extend a `tsx` pure test (mirror `scripts/test-*.ts`): predicate `phoneOk({ requirePhone, phone })` → false only when `requirePhone && !phone.trim()`. Assert require+blank=block, require+present=ok, not-require+blank=ok. Wire into the runner.

### B6. Turn on for Agile ONLY (after merge+deploy)
```sql
update organizations set inquiry_require_phone = true where id = '<AGILE_ORG_ID>';
```
Agile org id starts `921f7c08…` (per memory — confirm the full id first). Every other org stays false. Cowork can run this via Supabase MCP on Noam's go, or Noam runs it.

**Lane B acceptance:** flag off ⇒ "Phone (optional)", submits with no phone exactly as today. Flag on (Agile) ⇒ label "(required)", field `required`, blank-phone submit rejected client- AND server-side, both booking and inquiry paths enforced. esbuild/tsx-check clean; test passes. `get_public_listing` returns the new field for all orgs (false by default).

---

## Handoff checklist
- [ ] Review held Lane A (`git diff app/dashboard/showings/page.tsx`) — keep or drop.
- [ ] Codex builds Lane B off the current prod commit `db730cd` (NOT `main`); `npm run lint` + tsx suites + `next build` clean.
- [ ] Noam pushes + deploys.
- [ ] Flip Agile `inquiry_require_phone = true`.
- [ ] THEN text Aaliyah back (scheduling already sorted; confirm phone-required is live).
