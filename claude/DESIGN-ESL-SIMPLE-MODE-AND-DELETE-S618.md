# DESIGN — ESL Simple Mode + Delete/Archive (S618)

**Author:** Cowork (design pass, pre-build)
**Date:** 2026-08-03
**Prod baseline:** `a4fefdd` (S617 ESL simple-listing guide + posting plan LIVE)
**Status:** DESIGN — do NOT build until Noam signs off. Ships via the Codex warm-verify loop (WORKFLOW 206), one file-disjoint lane at a time.

---

## 1. Why (Noam's words, S618)

> "I don't like that I can't delete a draft listing from the rentals page… When I try to get this listed and go to that page it looks nice but it's very confusing. I still don't really understand what I'm supposed to do. This needs to be really simple and beautiful and clear — it's for an ESL person to help them get their post out to all the distribution channels, a real revenue generator and a great way for a landlord to manage themselves. Add property is now a lot better, but the more detailed part gets really long and confusing again."

## 2. The core insight

The property surface serves **two very different users on one screen**:

- **ESL operator / self-managing landlord** — needs *"get my one listing live across channels, simply."* Low tech/English literacy. This is the growth wedge.
- **Power operator** (Noam, Agile) — runs multi-channel distribution with analytics, concierge, automation, launch runs.

S617 tried to serve the first group by **adding** a "Simple posting plan" on top of the command center. That made the page *longer*, not simpler. The right move is a **mode split**: a genuinely simple **default**, with the existing command center preserved one click away as **Advanced**. The same principle ("basics visible, everything else optional") fixes the add-property complaint.

**Design north star for the default experience: one screen, top-to-bottom, no tab-hopping, one obvious next action.**

---

## 3. Verified current-state facts (grounding)

- **Statuses:** `draft`, `available` (Live), `paused`, `off_market`, `leased`. Helper `canPublishFromStatus()` = `draft | paused | off_market`.
- **Lifecycle actions that already exist** in `app/dashboard/properties/actions.ts`: `addProperty`, `createPropertyV2`, `updateProperty`, `publishProperty` (Set Live), `relistLeasedProperty`, `duplicateProperty`. **No delete, no archive.** (Only `deletePropertyDocument` / `softDeleteApplianceReceipts` exist — document-level.)
- **FK reality on `properties`:** `tenancies.property_id` = **`on delete restrict`** → a unit with any tenancy *cannot* be hard-deleted at the DB level. `leads.property_id` = **`on delete set null`** → inquiries survive but silently unlink. ~23 child tables reference `properties` (mix of cascade / set null / restrict).
- **Rentals list** (`app/dashboard/properties/page.tsx`): each row = address · specs · rent · `StatusChip` · a "Get this listing online →" action (or state label) · **Edit** (deep-links `#rental-details`) · readiness chips. No delete.
- **Get-online tab** (`[id]/distribute-tab.tsx`, 2,307 lines): renders `SimplePostingPlan` (5 steps) **then** `DistributionBasicsPanel`, `PostingModePanel` (concierge), next-action banner, `DistributionHealthPanel` (metrics grid), `AutomationStatusPanel`, `AnalyticsPanel`, channel cards, launch-run panel. The 5 steps link to anchors on **other tabs** (`#rental-details`, `#property-photos`, `#publish-action`, `#publish-checklist`, `#share`) → the disorienting tab-hop.
- **Tabs** (`[id]/tabbed-sections.tsx`): plain client `useState`, initial from hash anchor, **no persistence**.
- **Add-property** (`properties/new/add-property-form.tsx`, 1,165 lines): one scroll — Import (≈462–573) → **Core** address/rent/beds/baths (≈575–764) → **big optional block** parking/sqft/lease/amenities (≈777–1122) → Description (≈1122–1146). The middle block is never required to go live but is always fully expanded.

---

## 4. Lane 1 — Delete / Archive (one adaptive control)

**Goal:** the operator gets the "make this junk draft disappear" they asked for, and is structurally prevented from nuking a live unit's data.

### Behavior (the app decides, the user doesn't have to)
A single control per rentals row (trash/overflow), whose action adapts to attached history:

| Listing state | Control label | Action |
|---|---|---|
| **Deletable** = status ∈ {draft, off_market} **AND** 0 leads **AND** 0 tenancies (ever) **AND** 0 distribution posts | **Delete** | Hard delete + cascade child rows; single confirm |
| **Anything else** (live, leased, has inquiries/tenancy/posts) | **Archive** | Set `archived_at = now()`; hide from main list; recoverable |

Why the guard is stricter than the DB: `leads` only *set-null* on delete, so a hard delete would silently unlink real inquiries — we don't want that. `tenancies` *restrict* would hard-error, so archive is mandatory there anyway. The guard turns a DB footgun into a safe, legible choice.

### Data model
- **Migration 0208** (next free): `alter table properties add column archived_at timestamptz;` + partial index `where archived_at is not null`.
- Keep `archived` distinct from `off_market`: `off_market` = a real unit the operator paused; `archived_at` = removed from view. Main list filters `archived_at is null`.

### Server actions (new, in `properties/actions.ts`)
- `deleteProperty(formData)` — re-checks deletability server-side (never trust the client), org-scoped, then deletes. Explicitly cleans cascade-exempt children first if needed. Returns a friendly error if a tenancy/lead snuck in between render and click ("This listing now has history — archive it instead").
- `archiveProperty(formData)` / `unarchiveProperty(formData)` — set/clear `archived_at`, org-scoped.
- Pattern to mirror: `duplicateProperty` (existing mutating, org-scoped, revalidate).

### UI
- Rentals row: add a small **overflow (⋯) menu** or trailing icon → "Delete draft" (red) or "Archive," label chosen by the row's computed deletability.
- Confirm: **inline two-step** ("Delete → Confirm") or a small modal naming the address. Avoid raw `confirm()` (automation-hostile per KI). 
- Add an **"Archived" filter/segment** at the top of the list; archived rows show a "Restore" action.
- Empty-state copy unchanged.

### Verification
SQL before/after on a QA org: create a bare draft → Delete → row gone, child rows gone, no orphaned leads. Create a listing w/ a lead → control shows **Archive**, delete action *refuses* server-side. Archive → hidden from list, present under Archived, Restore returns it.

**This lane is fully file-disjoint from Lanes 2–3** (list page + actions + one migration). Ship it first.

---

## 5. Lane 2 — Get-online **Simple mode** (the headline)

**Goal:** the default Get-online experience becomes one calm, linear screen; the command center survives as opt-in Advanced.

### Mode
- **Default = Simple** whenever the listing is not yet Live (and for any operator who hasn't opted into Advanced).
- **"Advanced tools ▸"** toggle reveals today's full command center (health, automation, analytics, concierge, launch-run internals, channel cards).
- **Persistence:** MVP = remember the toggle client-side (localStorage, real app — allowed; the no-storage rule is artifacts-only) keyed per property-or-org, defaulting Simple. **Recommended follow-up:** an org-level default (`organizations.distribution_view_mode`) so a power org like Agile lands in Advanced automatically. Flag the choice for Noam.

### Simple mode layout (replaces what the ESL user sees)
The steps become the whole screen — **big, numbered, generously spaced** — and **each step resolves *inline* instead of jumping to another tab.** This inline resolution is the single most important fix.

1. **Finish the listing details** → expands a **compact basics editor inline** (rent, beds, baths, address only — the go-live-required set), *not* the 830-line Edit tab. "Done" collapses it green.
2. **Add photos** → inline uploader (reuse `photo-manager`), not a cross-tab hop.
3. **Set Live** → the `publishProperty` button right here, with the readiness blockers shown inline.
4. **Choose rental sites** → the site checklist inline (reuse launch-run start-channels).
5. **Connect the accounts those sites need** → *promoted to a first-class step* (see below). Show, per selected site that requires credentials, an inline "Connect [channel]" action; green when ready. Skippable for sites that don't need an account.
6. **Post, then paste the live ad link** → per-site paste inline.

### Connect-accounts — how it's handled (added after Noam's Q, S618)
Account connection is **not a tab today**; it surfaces as (a) the "Account access" card in `DistributionBasicsPanel` (`X/Y ready` → "Connect accounts" → links out to **`/dashboard/settings?tab=distribution`**), and (b) inline "Connect accounts" prompts in `launch-run-panel.tsx` per channel. It's a genuine prerequisite: some channels can't post until the operator's feed-partner account is connected. In the current Get-online tab this readiness is present but easy to miss, and it hard-jumps to Settings.

Simple mode makes it explicit and keeps it inline:
- **Step 5 = "Connect your accounts,"** rendered only for selected sites that actually require credentials (drive off `launchRun.startChannels[].readinessTone`). Sites that need nothing are auto-marked done.
- Each row: "Connect [channel] →" opening the connect flow **in place** (or, if the connect UI must live in Settings, a right-rail drawer / clearly-labelled round-trip that returns to this step — do NOT dump the ESL user on the Settings page with no way back). Green check when `readinessTone === "positive"`.
- The "Account access" 4-card tile stays in **Advanced**; Simple mode owns the explicit step instead.
- **Decision for Noam (added to §8):** can the connect flow render inline/drawer on the property page, or is it Settings-only today? If Settings-only, MVP = a labelled round-trip (deep-link out + return anchor back to step 5); inline drawer is a fast-follow. Cowork to confirm the connect UI's portability when writing the Lane 2 prompt.

- **One hero primary button** = "the next thing to do" (reuse the already-computed `nextAction`).
- A single clear **"You're live" state** when posted: the public link + inquiry count, calm, done.
- **Beauty:** this is where "beautiful" is spent — large step numerals, one accent green for done, whitespace, no metric grids in view.

### What moves to Advanced (unchanged, just gated)
`DistributionHealthPanel`, `AutomationStatusPanel`, `AnalyticsPanel`, `PostingModePanel`/concierge, launch-run internals, raw channel cards.

### Risk / why not a hard wizard
A forced Next/Next wizard traps power users and is a bigger rebuild of a freshly-shipped tab. Default-simple + inline steps + Advanced toggle gets the ESL clarity at much lower blast radius, and keeps the distribution engine intact.

### Verification
Dogfood on QA org (North Star) via Claude-in-Chrome: a not-live listing lands in Simple mode; each step opens/resolves inline with **zero tab navigation**; Set Live works; Advanced toggle reveals the old panels and sticks on reload; a Live+posted listing shows the calm "You're live" state.

---

## 6. Lane 3 — Add-property: collapse the middle block

**Goal:** get to a go-live-able listing on one short screen.

- Keep **Import** + **Core** (address, rent, beds, baths) always visible.
- Fold the ≈777–1122 block (parking, sqft, floor, laundry, A/C, balcony, furnished, pets, utilities, lease terms) into a **collapsed `<details>` "Add more details (optional)."**
- Keep **Description** visible (it's short and drives ad quality).
- Copy: "You only need the basics to get online. Add more anytime."

Small, low-risk, single-file (`add-property-form.tsx`). Directly answers the complaint.

### Verification
Add a property with Core only → creates a valid draft, reaches Live. Expander opens/saves the optional fields. No regression to import/geocode/prefill.

---

## 7. Sequencing & workflow

| Lane | Scope | Files | Migration | Risk |
|---|---|---|---|---|
| **1. Delete/Archive** | list page + actions | `properties/page.tsx`, `properties/actions.ts` | 0208 (`archived_at`) | Low, isolated |
| **2. Simple mode** | Get-online rethink | `[id]/distribute-tab.tsx`, `[id]/page.tsx`, maybe `tabbed-sections.tsx` | none | Med (headline) |
| **3. Add-property collapse** | one form | `new/add-property-form.tsx` | none | Low |

- Lanes are file-disjoint enough to ship independently. Recommended order: **1 → 3 → 2** (bank the two easy wins, then the headline).
- Each lane: Cowork writes `CODEX-PROMPT-*-S618.md` to `vacantless-app/claude/` (disk — Codex reads disk, not the project KB) → Codex builds → Cowork warm-verifies against a prod clone (tsc/lint/build/tests + diff-vs-prod) → migration-before-deploy + SQL readback → Noam file-scoped push, one lane at a time.

## 8. Open decisions for Noam
1. **Mode persistence** — MVP localStorage remember (ship now) vs org-level `distribution_view_mode` default (a touch more, auto-lands Agile in Advanced). Rec: ship localStorage now, add org default as a fast follow.
2. **Delete confirm UX** — inline two-step vs small modal. Rec: inline two-step (automation-friendly, less code).
3. **"Archive" naming** — "Archive" vs "Remove from list" vs "Hide." Rec: "Archive."
4. **Order** — confirm 1 → 3 → 2.
5. **Connect-accounts portability (Lane 2)** — can the channel connect flow render inline/drawer on the property page, or is it Settings-only (`?tab=distribution`) today? Rec: MVP = explicit Step 5 with a labelled round-trip to Settings + return anchor; inline drawer as fast-follow. Cowork confirms portability when writing the Lane 2 prompt.
