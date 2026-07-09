# S438 — Pre-screening page: first-time-user UX pass (Codex review handoff)

**Range to review:** `4c92a86..HEAD` (S438 commit).
**Scope:** view + action layer only. **No migration. The public/anon path
(`get_public_listing`, `submit_public_lead`) is untouched** — what gets asked and
what flags a lead is byte-identical; only the operator-facing page changed.

## What changed & why
Codex reviewed the operator screening page and found the mental model confusing:
a first-time landlord can't tell which questions renters actually see vs which
answers auto-flag a "possible mismatch", whether screening is on, or where flags
show up afterward. This fold addresses that without touching intake behavior.

1. **`lib/screening.ts`** — new PURE `describeScreeningStatus(config, activeCustomPrompts)`
   → `{ enabled, askedLabels[], flagLabels[] }`, plus `formatIncomeMultiple`.
   Reads the same stored config the evaluator reads; renders the asked-vs-flagged
   split as plain language. +26 tests (`test-screening` 115→**141/0**).

2. **`app/dashboard/leasing/screening/page.tsx`** — rewrite:
   - Title → **"Pre-screening settings"** (setup-page framing).
   - Top **status summary** card: On/Off badge, "Renters are asked: …", "Auto-flags
     a possible mismatch when: …", "Changes apply to new inquiries only", and two
     bridges (**Preview the renter form** → first available `/r/{id}` in a new tab;
     **View possible mismatches** → `/dashboard/leads?screen=out`).
   - Built-in section relabelled so **asking ≠ flagging** is explicit: master
     toggle "Ask pre-screening questions" lists the fixed fieldset; the threshold
     inputs are now "Flag income below …" / "Flag move-in further out than …" with
     "blank = asked, never flags"; occupants-never-flags note kept.
   - Reads active **and paused** custom questions.

3. **Custom questions** — pause/resume + hard delete:
   - `setScreeningQuestionActive` (new action): toggles `active` (hidden `active`
     field "1"/"0"). "Turn off" keeps the definition so it can be turned back on
     without re-authoring — the requested "pause without delete".
   - `deleteScreeningQuestion` (behavior change): was a soft delete (`active=false`);
     now a **hard delete**, offered ONLY on an already-off row (deliberate two-step).
     Safe: `leads.screen_custom_answers` is a self-contained snapshot with no FK to
     `org_screening_questions`, so past inquiries keep their answers.
   - Paused rows render greyed with an "Off" badge + "Turn on" (+ "Remove").

4. **`add-question-form.tsx`** (new client island) — progressive disclosure:
   "Preferred answer" shows only for yes/no; "Answer choices" only for multiple
   choice; "Available units" explains auto-generation and shows no field. UX only
   — real fields still post to `addScreeningQuestion`, which re-validates.

5. **`app/dashboard/leads/page.tsx`** — "Manage pre-screening →" link on the
   Screening filter row.

## Review focus / known trade-offs
- **Delete semantics changed** (soft→hard). Confirm the self-contained-snapshot
  reasoning holds (no FK; `screen_custom_answers` carries its own `prompt`).
- `describeScreeningStatus` asked-labels are the FIXED built-in fieldset (income,
  move-in date, pets, occupants) — correct as long as the master toggle gates that
  whole set (it does today; there is no per-built-in ask toggle).
- Status summary reads `org.*` columns directly; matches the evaluator's inputs.

## Deferred (NOT in this range) — Slice 2, needs a migration
Per-built-in "don't ask this one" on/off toggles. That requires new columns +
`get_public_listing`/`submit_public_lead` recreation + public-form gating (the
anon path), so it is intentionally out of this view-layer fold.

## Gate (Slice 1)
tsc clean · eslint clean · `test-screening` 141/0 · `test-screening-questions` 116/0.

---

# S438 Slice 2 — per-built-in "ask this question" toggles

**Second commit range (after Slice 1's `15fc45b`).** This is the deferred item:
turn each built-in (income / move-in / pets / occupants) on/off for the renter
form independently of flagging. **Touches the anon path** (`get_public_listing`)
so it gets its own review pass.

## Changes
1. **Migration `0116_screening_ask_toggles.sql` (APPLIED to prod via the Supabase
   connector + read-back verified).** 4 booleans on `organizations`
   (`screening_ask_income/movein/pets/occupants`), **NOT NULL DEFAULT true** →
   every existing org keeps asking all built-ins. `get_public_listing` recreated
   from 0071 with 4 added keys; everything else byte-identical.
   **`submit_public_lead` deliberately UNCHANGED** — a suppressed question is
   never submitted, so its answer arrives null and the evaluator already never
   flags a missing answer (option A: the flag is inert with no logic change).
2. **`lib/screening.ts`** — `OrgScreeningConfig` gains the 4 flags;
   `describeScreeningStatus` drops a built-in from `askedLabels` when its ask flag
   is off AND drops that criterion's flag from `flagLabels` (an unasked question
   can't fire). `validateScreeningSettings` reads the 4 (default true when
   omitted). +21 tests (`test-screening` 141→**162/0**).
3. **`lib/org.ts`** — `Org` type + explicit select list gain the 4 columns.
4. **Public form** — `r/[propertyId]/page.tsx` passes `askIncome/Movein/Pets/
   Occupants` (coalesced to true if the RPC key is absent) into `inquiry-form.tsx`,
   which gates the move-in / occupants / pets pill groups and the income field on
   them. Custom questions gate on screening-on. The "add a note" affordance always
   stays, so the "Help us prepare" fieldset is never empty.
5. **Settings** — new client island `screening-builtins.tsx`: master toggle + a
   per-built-in "Ask this on the renter form" checkbox, and the flag control greys
   live (option A) with a "question is off — this flag never fires" note when its
   question is unchecked. Greyed inputs stay ENABLED so the saved threshold is
   preserved (never lost on save); the flag is inert purely because the question
   yields no answer. `updateScreening` reads the 4 checkboxes.

## Review focus
- **Anon path:** confirm `get_public_listing`'s 4 added keys are the only change
  vs 0071 and the default-true back-compat holds (old app ignores the keys).
- **No `submit_public_lead` change** is the deliberate design — a suppressed
  question can't flag because its answer is absent. Confirm that reasoning.
- Option A: greyed flag inputs remain enabled (value preserved) — intentional.

## Gate (Slice 2)
tsc clean · eslint clean · `test-screening` **162/0** · `test-screening-questions` 116/0.
Migration 0116 applied + read-back verified on prod.
