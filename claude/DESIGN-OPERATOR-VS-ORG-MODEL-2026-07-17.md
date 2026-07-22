# Design — The Operator-vs-Org Model (unblocks IA Slices 3–5)

**Date:** 2026-07-17 · **Author:** Cowork · **Status:** DESIGN-FIRST (no code shipped). Resolves the data-model decision the IA audit (`IA-AUDIT-SETTINGS-DASHBOARD-OPERATOR-2026-07-16.md`) flagged as the blocker for Slice 3 (dashboard "my assigned ⇄ team") and Slice 4 (operator/user settings). Grounded in the live Agile schema + rows [verified 2026-07-17 via Supabase].

---

## The blocker, in one sentence

The app has **three** distinct "person/org" primitives, and the two that need to be connected — *who logs in* and *who shows units* — have **no link between them**, so the app can't answer "show me **my** assigned viewings" or "**my** settings" for the logged-in person.

---

## Current reality (verified on Agile)

Three tables, three different jobs:

| Primitive | Table | What it is | Agile's rows |
|---|---|---|---|
| **Organization** | `organizations` | The tenant/account. All shared config: billing, brand, booking rules, screening, policies, org-level notification toggles. | 1 org (`921f7c08…`) |
| **Member (login user)** | `memberships` (`user_id`, `role`) | An authenticated login identity within an org, with a role. "Who logs in." | 2: `rentals@agileonline.ca` (role **operator**), `thadmusco@gmail.com` (role **owner_admin**) |
| **Showing agent** | `showing_agents` (`tier`, `service_area`, `weekly_capacity`, `agent_token`) | The coverage/assignment roster. "Who attends showings." Reachable by magic-link token — **may or may not be a login user.** | 1: `rentals@agileonline.ca` (id `e1840a30…`) |

**Assignment** goes to a showing agent: 11 of 31 Agile showings have `assigned_agent_id`, and all 11 point at a `showing_agents.id` (not a user).

### The exact gap
`rentals@agileonline.ca` is **both** a login member (`user_id 37ffa625…`, role operator) **and** a showing-agent (`id e1840a30…`). The only thing tying those two rows together is that the email strings happen to match — **there is no `showing_agents.user_id`**. So to compute "Aaliyah's assigned viewings" you'd have to string-match her login email to a roster row, which is fragile and breaks the moment an agent's roster email ≠ their login email. Meanwhile `thadmusco` is a login owner with **no** showing-agent row — a legitimately admin-only operator who never shows.

This is why "operator" has been ambiguous: it has quietly meant *both* "a person who logs in and runs ops" *and* "a person on the showing roster," and those are different tables.

---

## Recommended model

Keep all three primitives — they answer different questions — and add the **one missing link**.

- **Organization** = the tenant. Everything shared/global lives here (unchanged).
- **Member** = a login identity + role. This is the **auth + permissions + personal-preferences** identity. "Operator" is a *role*, not a separate table.
- **Showing agent** = the coverage roster + assignment target. Keeps the magic-link (`agent_token`) path so an **external** agent who never logs in is still assignable.
- **The link (new):** `showing_agents.user_id` → nullable FK to the login user. Set it when a roster person is also a login member (Aaliyah); leave it null for external/magic-link-only agents; a login-only admin (thadmusco) simply has no roster row.

Canonical definitions to standardize the vocabulary:
- **"Operator"** = a **login member** who runs day-to-day leasing (role `operator`). Binds to "my …" in the app.
- **"Showing agent"** = the **roster identity** that attends showings. A member *can be* one (via the new link); an external contractor is one *without* being a member.
- A person is "me" in the UI via their **member** identity; their coverage/assignment is reached through the **linked showing-agent** row.

### The keystone migration (small, additive, safe)
```
alter table showing_agents add column user_id uuid references auth.users(id);
```
Backfill by confirmed email match where an agent is obviously a member (Agile: set `showing_agents e1840a30….user_id = 37ffa625…`). Treat the backfill as a **verified data step**, not an automatic email-join in code — email-matching is the fragility we're removing, so it shouldn't survive as runtime logic. This single nullable column is the entire unblock; everything below builds on it.

---

## How each blocked slice resolves under this model

**Slice 3 — Dashboard "my assigned ⇄ team".** "My" = showings whose `assigned_agent_id` ∈ `(select id from showing_agents where user_id = <current member>)`. A member with no linked agent (owner_admin who doesn't show) gets **no "my" lane** and defaults to the team view — which is exactly right. The toggle is: *My assigned today* (linked-agent showings) vs *Team* (all org showings). No new table beyond the keystone column.

**Slice 4 — Operator/User settings (new surface).** Splits cleanly across two homes:
- **Personal preferences** (my notification opt-in/out, my default dashboard filter) → attach to the **member/user**. Minimal new store: a `user_preferences` (and later `user_notification_prefs` as per-event overrides on top of the org defaults) table, keyed by `(user_id, organization_id)`. Additive; ships when Slice 4 does.
- **"My coverage"** (availability, weekly capacity, service area, tier) → these already live on the **showing_agents** row; the operator-settings page reads/writes the caller's **linked** agent row. No new columns — just the keystone link makes "my agent row" resolvable.

So the operator-settings surface is a thin view that joins *the member's prefs* + *the member's linked showing-agent row*. Nothing personal has to move off the org; it just gets a per-user overlay.

### Settings vs Operator-Settings, mapped to roles
The role vocabulary already exists (`owner_admin`, `operator`). Use it to draw the IA audit's "Global vs Operator" line:
- **Global Settings** (billing, brand/public identity, integrations/API keys, org booking + screening + policy defaults, org-level notification *defaults*) → **owner_admin**.
- **Operator/User Settings** (my notifications, my coverage, my dashboard defaults) → **any member, for themselves.**

That maps the audit's recommended split onto permissions with no new role machinery — just enforce `owner_admin` on the global surface.

---

## Generalize to customers 2–5 (this must not be Agile-only)
The model handles the shapes real PM customers will bring:
- **Solo owner-operator** (owns + shows): one member (`owner_admin`) linked to one showing-agent row.
- **Owner + operators** (Agile): an `owner_admin` who may not show + `operator` members who do, each linked to their agent row.
- **External showing agents** (dispatch/coverage network, Showami-style): showing-agent rows with `user_id = null`, assignable via magic link, never logging in.
- **Back-office admin** (books but never shows): a member with no linked agent — sees team views, no "my assigned" lane.
All four fall out of "member + optional link + roster," with no per-customer special-casing.

---

## Recommended build order (each slice its own reviewed ticket)
1. **Keystone migration** — `showing_agents.user_id` + Agile backfill. Tiny, additive, no UI. Ships first; unblocks 3 and 4. *(Its own small ticket; verify the backfill row on Agile before/after.)*
2. **Slice 3 — Dashboard my ⇄ team toggle.** Pure read using the new link; no further schema. Highest day-to-day value, lowest risk.
3. **Slice 4a — Operator settings: "my coverage."** Reads/writes the linked showing-agent row. No new table.
4. **Slice 4b — Operator settings: personal notification prefs + dashboard defaults.** Adds the `user_preferences` overlay. Ships after 4a.
5. **Slice 5 — Distribution** (unchanged from the audit): leave channel setup in Settings, keep publishing on the per-property Distribute surface. Lowest priority; no dependency on this model.

Every slice is additive and flag-safe; none changes Agile's live operator surface until built + reviewed + given the go — so this whole lane respects the current hold (it's design +, later, opt-in surfaces).

---

## Open decisions for Noam (the only real choices)
1. **Backfill scope now:** just link Agile's Aaliyah row (recommended), or hold the migration until Slice 3 is actually built? (Recommend: ship the column with Slice 3, not before — no value sitting alone.)
2. **Personal notification prefs = overrides or replacements?** Recommend **overrides on top of org defaults** (org sets the baseline recipients; a member can mute/add specific events for themselves) — safer than per-user full control while multi-tenant is young.
3. **Can an `operator` edit org defaults, or read-only?** Recommend `owner_admin`-only writes on Global Settings, `operator` read-only there + full control of their own Operator Settings.

## What this design rejects (and why)
- **Collapsing `showing_agents` into `memberships`** (every agent must be a login) — breaks external/magic-link showing agents, which the dispatch/coverage direction depends on.
- **Assignment referencing `memberships.user_id` directly** — same problem: non-login agents couldn't be assigned.
- **Email-matching member↔agent at runtime** — fragile (breaks when roster email ≠ login email); it's exactly the smell we're replacing with an explicit FK.
