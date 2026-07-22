# CODEX BUILD — S510: Operator settings, Slice 4b (part 1) — `user_preferences` + dashboard default view

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-07-17
**Design:** `claude/DESIGN-OPERATOR-VS-ORG-MODEL-2026-07-17.md` (Slice 4b — personal preferences overlay).
**Builds on:** S508 (dashboard My/Team toggle, `lib/dashboard-assigned.ts`, `showing_agents.user_id`) + S509 (`/dashboard/me` "My settings" page).
**Migration:** one new — `0156_user_preferences` (new table; additive, per-user RLS).
**Risk:** low–moderate. New table nobody reads until populated; one added lookup + a new default in the dashboard's existing view resolver (team path unchanged); a new card on `/dashboard/me`.
**Deploy timing:** build + Cowork-verify now. Migration is safe anytime (new empty table). The dashboard default + the new card are **operator-facing**, so deploy on Noam's go. Do not auto-push.

**Scope note — this is PART 1 of 4b only.** Design decision: 4b's *personal notification prefs* are **deferred to a separate design-first ticket** because notifications are modeled per-org (`notification_settings`, per-event `recipients[]`, code-defined operator/trade/tenant audience) and a per-user override changes live send-time recipient resolution across ~41 events. This ticket ships the `user_preferences` foundation + the one safe, self-contained personal pref: the **default dashboard view**. Do **not** touch the notification system here.

---

## Why

S508 gave a linked operator a My/Team toggle on the dashboard, defaulting to "My viewings" every load. A member who runs the whole team may want **Team** as their default. That is a *personal* preference — it attaches to the member, not the org. This ticket adds the per-user `user_preferences` overlay (keyed by `(user_id, organization_id)`) and uses it for the default dashboard view. It also establishes the store that future personal prefs (notification prefs, once designed) will extend.

---

## Part A — Migration `0156_user_preferences.sql`

A per-user, per-org overlay. **RLS is user-scoped** — unlike `notification_settings` (org-scoped), a member may read/write **only their own** row. Use the codebase idioms: `auth.uid()` for the user (see `0001_init.sql`, `0111_lease_ocr_usage.sql`) and `public.user_org_ids()` for the org guard.

```sql
-- Per-user, per-org preferences overlay. Absence of a row == code defaults.
-- User-scoped RLS: a member sees/edits only their own row.
create table if not exists public.user_preferences (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  organization_id       uuid not null references public.organizations(id) on delete cascade,

  -- default dashboard assigned-view for this member. null == no preference
  -- (fall back to the code default of "mine" for a linked member).
  default_assigned_view text check (default_assigned_view in ('mine','team')),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (user_id, organization_id)
);

create index if not exists user_preferences_user_org_idx
  on public.user_preferences (user_id, organization_id);

alter table public.user_preferences enable row level security;

drop policy if exists user_preferences_own on public.user_preferences;
create policy user_preferences_own on public.user_preferences
  for all
  using (user_id = auth.uid() and organization_id in (select public.user_org_ids()))
  with check (user_id = auth.uid() and organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.user_preferences to authenticated;
```
No `service_role` grant (no anon/cron path reads user prefs; the dashboard reads under the member's own session). No other RLS policy changes.

---

## Part B — Extend the view resolver (`lib/dashboard-assigned.ts`)

Add an optional saved default. **Backward-compatible** — `preferred` is optional; when absent, behavior is byte-identical to S508.

```ts
export type AssignedView = "mine" | "team";

/** Effective view. Unlinked members can only see Team. An explicit ?assigned
 * param always wins. With no param, use the member's saved default, else "mine". */
export function resolveAssignedView(args: {
  hasLinkedAgent: boolean;
  param: string | string[] | undefined;
  preferred?: AssignedView | null;
}): AssignedView {
  if (!args.hasLinkedAgent) return "team";
  const p = Array.isArray(args.param) ? args.param[0] : args.param;
  if (p === "team") return "team";
  if (p === "mine") return "mine";
  return args.preferred === "team" ? "team" : "mine";
}
```

---

## Part C — Dashboard reads the saved default (`app/dashboard/page.tsx`)

After the existing linked-agent resolve (S508), fetch the member's pref and pass it through. One added query; the `team` and explicit-`?assigned` paths are unchanged.

```ts
// after hasLinkedAgent / myAgentId are known and only when hasLinkedAgent:
let preferred: AssignedView | null = null;
if (hasLinkedAgent) {
  const { data: prefRows } = await supabase
    .from("user_preferences")
    .select("default_assigned_view")
    .eq("user_id", user.id)          // reuse the user object S508 already fetched
    .eq("organization_id", org.id)
    .limit(1);
  const v = prefRows?.[0]?.default_assigned_view;
  preferred = v === "team" || v === "mine" ? v : null;
}
const assignedView = resolveAssignedView({
  hasLinkedAgent,
  param: searchParams?.assigned,
  preferred,
});
```
(If S508 didn't retain the `user` object in scope, resolve it once via `supabase.auth.getUser()` — do not add a second call if one already exists.) **Scope guard:** do not change any other dashboard lane, query, or the toggle UI. An explicit `?assigned=` in the URL must still win over the saved default (the resolver already guarantees this).

---

## Part D — "Dashboard defaults" card on `/dashboard/me` (`app/dashboard/me/page.tsx`)

Add a second card **below** the S509 "My coverage" card, rendered under the **same `hasLinkedAgent` gate** (the default-view pref is meaningless for a member with no My/Team toggle). Read the current pref alongside the existing linked-agent lookup:

```ts
// extend the existing me query or add a small one:
const { data: prefRows } = await supabase
  .from("user_preferences")
  .select("default_assigned_view")
  .eq("user_id", user.id)
  .eq("organization_id", org.id)
  .limit(1);
const defaultView = prefRows?.[0]?.default_assigned_view === "team" ? "team" : "mine";
```

Card UI (match the S509 card styling / `@/components/ui`):
- Heading: "Dashboard defaults".
- One `<form action={updateMyDashboardDefaults}>` with a two-option control for **Default viewings view**: "My viewings" (value `mine`) and "Team" (value `team`) — radio group or a select; default-selected = `defaultView`. Helper text: "Which viewings the dashboard shows first when you open it. You can still switch anytime."
- Primary submit "Save defaults".
- Extend the `?me=` flash map: `defaults_saved` → "Dashboard defaults saved." (ok).

When `!hasLinkedAgent`: render neither card (the existing S509 empty state stays as-is).

---

## Part E — Self-scoped upsert action (`app/dashboard/me/actions.ts`)

Add alongside `updateMyCoverage`. Upsert the caller's own `user_preferences` row; the write is keyed to `auth.uid()`, never a form-supplied id.

```ts
export async function updateMyDashboardDefaults(formData: FormData) {
  const supabase = createClient();
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/onboarding");

  const raw = formData.get("default_assigned_view");
  const view = raw === "team" ? "team" : raw === "mine" ? "mine" : null;
  if (view === null) redirect(`${BASE}?me=defaults_saved`); // nothing to change

  await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: user.id,
        organization_id: org.id,
        default_assigned_view: view,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,organization_id" },
    );

  revalidatePath(BASE);
  revalidatePath("/dashboard");
  redirect(`${BASE}?me=defaults_saved`);
}
```
RLS guarantees the upsert can only affect the caller's own row. Do not add an `.eq` on a form id; there is none.

---

## Gates (this repo)
- `next build` (tsc) clean.
- `next lint` green (pre-existing job-page `<img>` advisory allowed).
- `git diff --check` clean.
- Report unit-test counts.

## Tests — `scripts/test-dashboard-assigned.ts` (pure, no I/O)
Extend the `resolveAssignedView` cases for `preferred`:
- `hasLinkedAgent:false` → `"team"` regardless of `preferred` or `param`.
- linked, `param:undefined`, `preferred:"team"` → `"team"`.
- linked, `param:undefined`, `preferred:"mine"` → `"mine"`.
- linked, `param:undefined`, `preferred:null`/omitted → `"mine"` (S508 default preserved).
- linked, `param:"mine"`, `preferred:"team"` → `"mine"` (explicit param wins).
- linked, `param:"team"`, `preferred:"mine"` → `"team"` (explicit param wins).
- Confirm all existing S508 `resolveAssignedView` cases still pass unchanged.

## Verification (Cowork, after Codex builds)
1. `device_bash git diff` review: changes confined to `supabase/migrations/0156_user_preferences.sql`, `lib/dashboard-assigned.ts`, `scripts/test-dashboard-assigned.ts`, `app/dashboard/page.tsx`, `app/dashboard/me/page.tsx`, `app/dashboard/me/actions.ts`. No notification-system changes; no other RLS policy edits; the dashboard `team` + explicit-`?assigned` paths unchanged; S509 "My coverage" card untouched.
2. Apply migration `0156` via Supabase MCP; confirm the table + unique index + the user-scoped RLS policy exist, and that the policy uses `auth.uid()` (per-user), not just org scope.
3. **RLS spot check (read-only):** confirm the policy is `user_id = auth.uid()`-scoped so one member cannot read another's prefs row.
4. Browser QA on Agile (on Noam's go, operator-facing):
   - As `rentals@` (linked): `/dashboard/me` now shows "My coverage" **and** "Dashboard defaults"; set default to **Team**, save → reload `/dashboard` with no `?assigned` param → it opens on **Team**; visiting `/dashboard?assigned=mine` still shows Mine (explicit wins). Revert to My.
   - As `thadmusco` (unlinked): `/dashboard/me` still the empty state, no cards.

## Standing rules
Codex builds; Cowork verifies the real diff via `device_bash git`; **Noam pushes**; migrations to prod via Supabase MCP. Do not auto-push. Operator-facing — do not deploy until Noam's go. Never persist tenant PII/secrets.
