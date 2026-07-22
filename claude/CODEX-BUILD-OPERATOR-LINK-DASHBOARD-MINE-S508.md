# CODEX BUILD — S508: Operator↔agent link (keystone) + Dashboard "My assigned ⇄ Team"

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-07-17
**Design:** `claude/DESIGN-OPERATOR-VS-ORG-MODEL-2026-07-17.md` (Slice-3 + its keystone migration).
**Migration:** one new — `0155` (additive column + indexes; no data change in the migration).
**Risk:** low. Part A is an invisible nullable column. Part B adds a dashboard *view filter*; it does not change how showings are booked, reminded, or assigned.
**Deploy timing:** build + Cowork-verify now. The **migration is safe to apply anytime** (invisible to operators). The **dashboard UI change is operator-facing**, so deploy it on Noam's go once the Agile operator hold lifts (≈ after Jul 24). Do not auto-push.

---

## Why

Three person/org primitives exist — `organizations` (tenant), `memberships` (login user + role), `showing_agents` (coverage roster / assignment target) — but **who logs in** and **who shows units** are not linked. On Agile, `rentals@agileonline.ca` is both a member (`user_id 37ffa625…`, role `operator`) and a showing-agent (`id e1840a30…`), tied only by a matching email string. So the dashboard can't answer "show me **my** assigned viewings." This ticket adds the missing FK and uses it for the dashboard My/Team toggle (Slice 3). See the design doc for the full model and how it unblocks Slice 4.

---

## Part A — Keystone migration `0155_showing_agent_user_link.sql`

Schema only. Nullable, so every existing row and future insert is unaffected. An external showing agent (magic-link, no login) keeps `user_id = null`.

```sql
-- Link a showing-agent roster row to its login user, when the agent is also a
-- member. Nullable: external/magic-link agents stay unlinked. on delete set null
-- so deleting a user unlinks rather than removing the roster row.
alter table public.showing_agents
  add column if not exists user_id uuid references auth.users(id) on delete set null;

-- At most one agent row per (org, user): a login maps to a single roster identity.
create unique index if not exists showing_agents_org_user_uniq
  on public.showing_agents (organization_id, user_id)
  where user_id is not null;

-- Fast "my linked agent" lookup.
create index if not exists showing_agents_user_idx
  on public.showing_agents (user_id)
  where user_id is not null;
```

**RLS:** no change. The existing `showing_agents_all` / same-org policies (migrations 0113/0114) already let a member read their org's showing-agent rows, which is all Part B needs. Do **not** widen any policy.

**Backfill is NOT in the migration.** It's a one-org data step Cowork applies post-migration after verifying the email match (see Verification). Migration stays pure/reusable.

---

## Part B — Dashboard "My assigned ⇄ Team" (Slice 3)

**File:** `app/dashboard/page.tsx` (server component, `export const dynamic = "force-dynamic"`). Plus one small pure helper + its test. No client data-fetching — the toggle is URL-param driven (fits the server component).

### Resolve the caller's linked agent
After `const org = await getCurrentOrg();`, resolve the current user's linked agent in this org:
```ts
const { data: { user } } = await supabase.auth.getUser();
const { data: myAgentRows } = await supabase
  .from("showing_agents")
  .select("id")
  .eq("user_id", user?.id ?? "00000000-0000-0000-0000-000000000000")
  .eq("organization_id", org.id)   // belt-and-suspenders; RLS also scopes
  .eq("archived", false)
  .limit(1);
const myAgentId: string | null = myAgentRows?.[0]?.id ?? null;
const hasLinkedAgent = myAgentId != null;
```
(`org.id` — confirm the field name on the `getCurrentOrg()` return type; use whatever the `Org` type exposes.)

### Pure view resolver (new, tested) — `lib/dashboard-assigned.ts`
```ts
export type AssignedView = "mine" | "team";
/** Effective view: unlinked members can only see Team; linked members default
 *  to Mine unless they asked for Team. Pure; unit-tested. */
export function resolveAssignedView(args: {
  hasLinkedAgent: boolean;
  param: string | string[] | undefined;
}): AssignedView {
  if (!args.hasLinkedAgent) return "team";
  const p = Array.isArray(args.param) ? args.param[0] : args.param;
  return p === "team" ? "team" : "mine";
}
```
Read the param from the page's `searchParams` (add `searchParams` to the page props if not present): `const view = resolveAssignedView({ hasLinkedAgent, param: searchParams?.assigned });`

### Apply the filter
The upcoming-viewings query (currently `.from("showings").select(...).eq("outcome","scheduled").gte("scheduled_at",now).order().limit(5)`) and the awaiting-confirmation count (the `.not("assigned_agent_id","is",null)…` head-count query) both gain the same conditional filter:
```ts
// build the base query, then:
if (view === "mine" && myAgentId) q = q.eq("assigned_agent_id", myAgentId);
```
`team` keeps today's behavior exactly (no assignment filter). Since these run inside the existing `Promise.all([...])`, build each query into a variable before the array or apply the `.eq` inline — match the file's existing style; don't restructure the batch more than necessary.

### UI — segmented toggle (render only when `hasLinkedAgent`)
Above the upcoming-viewings section, render a two-item segmented control as plain links (no client component needed):
- "My viewings" → `?assigned=mine`, `aria-current` when `view==="mine"`.
- "Team" → `?assigned=team`, `aria-current` when `view==="team"`.

Use the existing UI primitives / styling in `@/components/ui`. When `!hasLinkedAgent` (e.g. an `owner_admin` who doesn't show), render **no toggle** and the section is Team as today — zero change for them.

**Empty state:** `view==="mine"` with no rows → the existing `EmptyState` with copy like "No viewings are assigned to you right now." (house style: hyphens, no em dashes).

**Scope guard:** Slice 3 is *only* this My/Team filter on the viewings surface. Do not touch booking, reminders, assignment logic, or other dashboard lanes.

---

## Gates (this repo)
- `next build` (tsc) clean.
- `next lint` green (pre-existing job-page `<img>` advisory is known/allowed).
- `git diff --check` clean.
- Report unit-test counts.

## Tests — `scripts/` (pure, no I/O)
Add tests for `resolveAssignedView`:
- `hasLinkedAgent:false` → always `"team"` (param ignored).
- `hasLinkedAgent:true`, param `undefined` → `"mine"` (default).
- param `"team"` → `"team"`; param `"mine"` → `"mine"`; unknown param → `"mine"`; array param `["team"]` → `"team"`.

## Verification (Cowork, after Codex builds)
1. `device_bash git diff` review: changes confined to `supabase/migrations/0155_showing_agent_user_link.sql`, `app/dashboard/page.tsx`, `lib/dashboard-assigned.ts`, and the new test. Booking/reminder/assignment code untouched; no RLS policy edits; `team` path byte-equivalent to today.
2. Apply migration **0155** via Supabase MCP; confirm the column + both indexes exist and no existing row changed.
3. **Agile backfill** (Cowork, Supabase, after confirming the email match `rentals@agileonline.ca` = member `37ffa625…` = agent `e1840a30…`):
   ```sql
   update public.showing_agents set user_id = '37ffa625-7f3f-415b-8704-0ccab3cfc170'
   where id = 'e1840a30-a4e7-4734-987e-345c9d70b5d3'
     and organization_id = '921f7c08-98af-428f-a238-36f4a781b0de' and user_id is null;
   ```
4. Browser QA on Agile (do this **only when Noam lifts the hold / on his go**, since it's operator-facing):
   - As `rentals@` (operator, now linked): toggle appears; **My viewings** shows only her assigned viewings (she has 11 assigned of 31), **Team** shows all upcoming.
   - As `thadmusco` (owner_admin, no linked agent): **no toggle**, Team view, unchanged from today.

## Standing rules
Codex builds; Cowork verifies the real diff via `device_bash git`; **Noam pushes**; migrations to prod via Supabase MCP. Do not auto-push. The dashboard change is operator-facing — do not deploy it to Agile until Noam lifts the operator hold and gives the go. Never persist tenant PII/secrets.
