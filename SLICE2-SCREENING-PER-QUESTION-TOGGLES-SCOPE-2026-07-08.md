# Slice 2 scope — per-built-in "ask this question" toggles

**Goal (the one acceptance item S438 deferred):** let the operator turn each
built-in question (income, move-in date, pets, occupants) ON/OFF for the renter
form *independently of* whether its answer auto-flags. Today the four built-ins
are asked as a fixed set whenever the master toggle is on; only flagging is
per-criterion.

**Why it's a separate slice:** it changes the DB and the **anon public path**
(`get_public_listing`), unlike S438 which was operator-view only. Higher blast
radius, so it gets its own migration + QA loop.

## Changes

1. **Migration (additive, back-compatible).** 4 booleans on `organizations`,
   default **true** so every existing org keeps today's behavior (all asked when
   master on): `screening_ask_income`, `screening_ask_movein`,
   `screening_ask_pets`, `screening_ask_occupants`.

2. **`get_public_listing` (recreate — the anon RPC).** Emit the 4 ask flags
   (only meaningful when `screening_enabled`). This is the sensitive edit; keep
   everything else byte-identical, mirror the 0051/0050 recreate discipline.

3. **`submit_public_lead` — NO logic change needed.** A suppressed question means
   the renter never submits that field → the value arrives null → it already
   never flags (missing answers never flag) and never snapshots. Optionally add a
   defensive "ignore an answer for a suppressed question," but correctness holds
   without it. *This is what keeps the slice's risk down.*

4. **Public form** (`app/r/[propertyId]/page.tsx` + `inquiry-form.tsx`). Thread
   the 4 flags in as props; gate the income / occupants / pets fieldsets on them
   (income is already conditionally rendered; occupants + pets pills currently
   always render — add the gates). Move-in lives on the base lead form, so an
   "ask move-in" off just hides that input.

5. **`lib/screening.ts` (pure + tests).** Extend `OrgScreeningConfig` with the 4
   flags; `validateScreeningSettings` reads them; **`describeScreeningStatus`
   drops a built-in from `askedLabels` when its flag is off** (so the S438 status
   summary stays truthful). Add unit tests.

6. **Settings page** (`app/dashboard/leasing/screening/page.tsx`). A per-built-in
   "Ask this on the renter form" checkbox on each of the four. `updateScreening`
   in `settings/actions.ts` saves them.

## One design decision for Noam
When a built-in question is turned **off**, do we:
- **(A, recommended)** auto-neutralize its flag in the UI — grey out / ignore the
  threshold, since a question that isn't asked can never flag anyway (least
  surprising, matches reality); or
- **(B)** keep them fully independent and just show a subtle "this question is
  off, so its flag never fires" note.

Either is cheap; (A) reads cleaner. Everything else above is mechanical.

## Risk / effort
- **Risk:** one anon-path recreate (`get_public_listing`); default-true keeps
  back-compat; occupants is always safe (never flags). No `submit_public_lead`
  logic change.
- **Effort:** ~1 migration + 1 pure-lib change (+tests) + public-form gating +
  settings checkboxes. Half a focused session; live-QA on North Star with a real
  public-form submit to prove a suppressed question doesn't appear or persist.
