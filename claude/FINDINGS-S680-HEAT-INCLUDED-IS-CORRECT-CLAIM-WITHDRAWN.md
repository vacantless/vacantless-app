# WITHDRAWN S680 - "heat_included is wrong on the Pillette units" was MY ERROR. Heat IS included.

**This file previously argued that `heat_included = true` was wrong on the Pillette units. That was
wrong. The claim is WITHDRAWN in full. Do not act on any earlier copy of it.**

## The owner's answer, in writing [2026-09-05 12:45:48Z]

Narayan, replying in blue highlighted ink in Gmail thread `1a00fced3ee3284d`, message
`1a0719a96d4fcced`:

> **"Landlord pays Heat and Tenant pays Hydro ( Fridge, stove, fixtures and AC units -if
> applicable). The current wording for Unit3 and 33 is correct."**

He also answered the other question:

> **Unit 32: "This is rented, tenant moved in."**

## What I got wrong, and how

The reasoning chain was: electric baseboard heaters are visible in the Unit 36 and Unit 3 photos,
and the Aug 31 vacancy schedule prices every unit "plus hydro", therefore the tenant must be paying
for heat through their own hydro account, therefore `heat_included = true` must be a stale default.

Every observation in that chain was true. **The conclusion was still wrong.** The heaters are
electric baseboard, hydro is tenant-paid, and the landlord still pays for heat. Whatever the
metering arrangement is, the commercial term is the owner's to state, and he states it plainly.

**Noam agreed with my inference at the time** ("obviously baseboard are hydro"). That agreement was
not independent confirmation - it was the same inference from the same photographs. **Two people
reasoning from the same evidence is one source, not two.**

## The real lesson, which is the opposite of the one I drew

I opened this investigation by accusing the database of carrying an unexamined default, and I was
pleased with myself for catching it. The database was right and I was the one guessing. A field
being old, uniform across rows, and unsupported by any document is **not** evidence that it is
wrong - it is only evidence that its provenance is unrecorded.

**A utility term is a commercial fact, not a physical one. It cannot be read off a photograph.**
Ask the owner. That is what the email was for, and the correct move was to wait the ~16 hours for
the answer rather than change a live listing on a photo-derived theory.

## Damage and repair

- **Unit 36 (`15a8a7de`) was changed on the bad theory and went LIVE with it.** Set to
  `heat_included = false` and its description rewritten to "heat is electric baseboard and is
  billed to the tenant through hydro" on 2026-09-04, published 21:19Z, public for about 24 hours.
- **REPAIRED 2026-09-05** [verified via Supabase read-back]: `heat_included` back to `true`,
  description restored to "Heat and water included, hydro extra." `water_included` true and
  `hydro_included` false were never touched and were always correct.
- **Units 3, 20 and 33 were NOT changed**, because the plan was to prove the edit on one listing
  before batching three live ones. That discipline is the only reason this cost one listing instead
  of four. **Keep doing that.**
- `heating_type = 'baseboard'` is KEPT on Unit 36. That one is a physical fact from the
  photographs, it is accurate, and it says nothing about who pays.

## Still true and worth keeping from the original sweep

- `photos/833 Pillette Rd/_unit3-kijiji/` holds two correct-building exteriors
  (`02-exterior.jpg`, `12-exterior-facade.jpg`) and a shared laundry room shot
  (`10-laundry-room.jpg`), corroborating `laundry = in_building`. Unit 36 has no exterior of its
  own, so under the S42 same-building policy these are the ones to use.
- `heating_type` remains NULL on Units 3, 20 and 33. Setting it to `baseboard` would be accurate
  and is harmless, but it is not required by anything.

[[project_agile_vacancy_to_fb_marketplace]] [[project_agile_leasing_engine]]
