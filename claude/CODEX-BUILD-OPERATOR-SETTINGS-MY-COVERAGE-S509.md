# CODEX BUILD — S509: Operator settings, Slice 4a — "My coverage" (self-serve)

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-07-17
**Design:** `claude/DESIGN-OPERATOR-VS-ORG-MODEL-2026-07-17.md` (Slice 4a — "my coverage") + `claude/IA-AUDIT-SETTINGS-DASHBOARD-OPERATOR-2026-07-16.md` (Operator/User settings surface).
**Builds on:** S508 (mig `0155` added `showing_agents.user_id`; Agile backfill applied — `rentals@` login `37ffa625…` ↔ agent `e1840a30…`).
**Migration:** NONE. The keystone column already exists. This slice is pure UI + one self-scoped server action + one pure validator + its test.
**Risk:** low. Additive new route `/dashboard/me`; one new nav item; no change to any existing page, action, RLS policy, booking/assignment/reminder path, or the org roster surface.
**Deploy timing:** build + Cowork-verify now. The new page + nav item **are operator-facing** (visible to Aaliyah), so deploy on Noam's go once the Agile operator hold lifts (≈ after Jul 24). Do not auto-push.

---

## Why

The operator-vs-org model (S508) linked a login member to their showing-agent roster row via `showing_agents.user_id`. That unblocked Slice 3 (dashboard My/Team). Slice 4a is the first personal-settings surface: a member editing **their own coverage** (service area, product types, weekly capacity) without going through the org-wide roster admin. It is the home that Slice 4b (personal notification prefs + dashboard defaults) will extend. It also serves a linked `showing_helper` — who cannot reach the `manage_settings`-gated org roster page at all — giving them a way to maintain their own coverage.

This is additive and flag-safe: the editable form only renders for a member whose login is linked to a showing-agent row; everyone else sees a read-only "you're not on the showing roster" state. Nothing on Agile's live operator surface changes until this is built, reviewed, and given the go.

---

## Verified-fact correction to the design doc (read before building)

The design doc lists **availability** under "my coverage." That is **wrong against the live schema** and is **OUT OF SCOPE** here:

- Availability is **org-level**, not per-agent: `availability_rules`, `availability_days_off`, and `availability_overrides` are all keyed by `organization_id` (see `app/dashboard/availability/actions.ts`). It is the shared opt-in calendar the operator already controls at `/dashboard/availability` ("Viewing Times" in the nav).
- `showing_agents` has **no** availability columns. "My coverage" is therefore strictly the per-agent roster fields.

So Slice 4a edits exactly three fields on the caller's linked `showing_agents` row: **`service_area`, `product_types`, `weekly_capacity`**. `tier` is shown **read-only** (it's an admin routing decision — a member must not self-promote their tier). Name / email / phone / note stay admin-managed on the org roster (out of scope here). Do not add availability editing to this page.

---

## Scope (exactly this)

1. New pure validator `validateCoverage()` in `lib/showing-agents.ts` + tests.
2. New self-scoped server action `updateMyCoverage(formData)` in `app/dashboard/me/actions.ts`.
3. New page `app/dashboard/me/page.tsx` — "My settings", with the "My coverage" card (4a). Gated on `hasLinkedAgent`.
4. One new account-menu item → `/dashboard/me` in `app/dashboard/dashboard-nav.tsx`.

Do **not** touch: `app/dashboard/showing-agents/*` (the org roster), `app/dashboard/page.tsx` (S508), `app/dashboard/availability/*`, any migration, any RLS policy, or the `lib/dashboard-assigned.ts` resolver.

---

## Part A — Pure validator `validateCoverage()` (in `lib/showing-agents.ts`)

Reuse the existing `normalizeProductTypes`, `MAX_AGENT_FIELD_LEN`, and the same capacity rule as `validateShowingAgent` (non-negative integer or null; mirrors the CHECK in 0113). Keep it pure (no I/O) so it unit-tests with the existing `scripts/test-showing-agents.ts` harness.

```ts
export type CoverageInput = {
  service_area: string | null;
  product_types: ProductType[];
  weekly_capacity: number | null;
};

export type CoverageValidation =
  | { ok: true; value: CoverageInput }
  | { ok: false; code: string };

/** Validate the self-serve "my coverage" subset (service_area, product_types,
 *  weekly_capacity). No name here — a member edits coverage on their own linked
 *  agent row; identity fields stay admin-managed on the org roster. */
export function validateCoverage(raw: {
  service_area?: string | null;
  product_types?: readonly (string | null | undefined)[] | null;
  weekly_capacity?: string | number | null;
}): CoverageValidation {
  const trimOrNull = (v: string | null | undefined): string | null => {
    const t = (v ?? "").trim();
    if (t === "") return null;
    return t.length > MAX_AGENT_FIELD_LEN ? t.slice(0, MAX_AGENT_FIELD_LEN) : t;
  };

  let weekly_capacity: number | null = null;
  if (
    raw.weekly_capacity !== null &&
    raw.weekly_capacity !== undefined &&
    `${raw.weekly_capacity}`.trim() !== ""
  ) {
    const n =
      typeof raw.weekly_capacity === "number"
        ? raw.weekly_capacity
        : Number(raw.weekly_capacity);
    if (!Number.isInteger(n) || n < 0) return { ok: false, code: "capacity_invalid" };
    weekly_capacity = n;
  }

  return {
    ok: true,
    value: {
      service_area: trimOrNull(raw.service_area),
      product_types: normalizeProductTypes(raw.product_types),
      weekly_capacity,
    },
  };
}
```
(If you prefer, lift the existing in-function `trimOrNull` in `validateShowingAgent` to a module-level helper and share it — either way, no behavior change to `validateShowingAgent`.)

---

## Part B — Self-scoped action `updateMyCoverage` (`app/dashboard/me/actions.ts`)

Mirror the shape of `updateShowingAgent` in `app/dashboard/showing-agents/actions.ts` (createClient, getCurrentOrg, validate, update, revalidatePath, redirect), but resolve the target row from the **caller's own linked agent**, never from a form-supplied id.

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { validateCoverage } from "@/lib/showing-agents";

const BASE = "/dashboard/me";

export async function updateMyCoverage(formData: FormData) {
  const supabase = createClient();
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/onboarding");

  // The caller's OWN linked agent row (never trust a form id).
  const { data: rows } = await supabase
    .from("showing_agents")
    .select("id")
    .eq("user_id", user.id)
    .eq("organization_id", org.id)
    .eq("archived", false)
    .limit(1);
  const agentId: string | null = rows?.[0]?.id ?? null;
  if (!agentId) redirect(`${BASE}?me=not_linked`);

  const check = validateCoverage({
    service_area: formData.get("service_area") as string | null,
    product_types: formData.getAll("product_types") as string[],
    weekly_capacity: formData.get("weekly_capacity") as string | null,
  });
  if (!check.ok) redirect(`${BASE}?me=${check.code}`);

  // Update ONLY the caller's own row; re-scope by user_id + org (defense in depth
  // on top of the per-org RLS). Coverage fields only — never tier/name/email/
  // archived/user_id.
  await supabase
    .from("showing_agents")
    .update({
      service_area: check.value.service_area,
      product_types: check.value.product_types,
      weekly_capacity: check.value.weekly_capacity,
    })
    .eq("id", agentId)
    .eq("user_id", user.id)
    .eq("organization_id", org.id);

  revalidatePath(BASE);
  redirect(`${BASE}?me=saved`);
}
```

**RLS:** unchanged. `showing_agents_all` (0113) already scopes read+write to the caller's org; the extra `.eq("user_id", user.id)` limits the write to the caller's own linked row within that org. Do not widen any policy.

---

## Part C — Page `app/dashboard/me/page.tsx` ("My settings" → "My coverage" card)

Server component, `export const dynamic = "force-dynamic"`. Auth-only gate (no `requireCapability` — this is self-service; a linked `showing_helper` must be able to use it). Resolve the caller's linked agent inline (same pattern as S508's dashboard resolver — do **not** import/edit `lib/dashboard-assigned.ts`).

```ts
const supabase = createClient();
const org = await getCurrentOrg();
if (!org) redirect("/onboarding");
const { data: { user } } = await supabase.auth.getUser();
if (!user) redirect("/onboarding");

const { data: rows } = await supabase
  .from("showing_agents")
  .select("id, name, tier, service_area, product_types, weekly_capacity")
  .eq("user_id", user.id)
  .eq("organization_id", org.id)
  .eq("archived", false)
  .limit(1);
const me = rows?.[0] ?? null;
const hasLinkedAgent = me != null;
```

UI:
- Use the existing primitives from `@/components/ui` (`PageHeader`, `SectionHeading`, `EmptyState`, `PRIMARY_ACTION_CLASS`) and the `FIELD` / `LABEL` class strings and the `PRODUCT_TYPES` checkbox pattern already in `app/dashboard/showing-agents/page.tsx` — match that styling so it reads as one system.
- **Header:** "My settings" (page title). Subtitle: your personal coverage and preferences for {org name}.
- **"My coverage" card**, rendered only when `hasLinkedAgent`:
  - Read-only line: name (`me.name`) and a tier chip ("Tier: {me.tier ?? '—'} · set by your admin"). Tier is display-only, not an input.
  - `<form action={updateMyCoverage}>` with: `service_area` text input (value `me.service_area ?? ""`); a checkbox per `PRODUCT_TYPES` named `product_types` (checked when in `me.product_types`); `weekly_capacity` number input (`min=0`, value `me.weekly_capacity ?? ""`, blank = uncapped, helper "Leave blank for no weekly cap"); a primary "Save coverage" submit.
- **When `!hasLinkedAgent`:** render an `EmptyState` — "You're not on this organization's showing roster yet. Ask an admin to add you so you can set your coverage." No form. (Correct for an `owner_admin` who never shows.)
- **Flash messages** via `?me=` (same pattern as the roster page's `?agent=`):
  - `saved` → "Coverage saved." (ok)
  - `capacity_invalid` → "Weekly capacity must be a whole number, 0 or more." (err)
  - `not_linked` → "You're not on the showing roster, so there's no coverage to save." (err)

House style: hyphens, no em dashes; sentence case.

---

## Part D — Nav item (`app/dashboard/dashboard-nav.tsx`)

Add one item to the account/org menu array (`ORG_MENU`, currently Settings / Automations & templates / Your plan). Insert **"My settings" → `/dashboard/me`** (suggest first in that group, above "Settings"). It renders in both the desktop org-pill menu and the mobile inline menu (both map over the same array — verify). No conditional gating on the link itself (the page handles the linked/unlinked states); every member gets a personal-settings home. Update the ASCII comment at the top of the file (the `ORG ▾ : Settings · Your plan · …` line) to include "My settings".

---

## Gates (this repo)
- `next build` (tsc) clean.
- `next lint` green (pre-existing job-page `<img>` advisory is known/allowed).
- `git diff --check` clean.
- Report unit-test counts.

## Tests — `scripts/test-showing-agents.ts` (pure, no I/O)
Add `validateCoverage` cases:
- empty/blank inputs → `ok:true`, `service_area:null`, `product_types:[]`, `weekly_capacity:null`.
- `weekly_capacity:"3"` → `ok:true`, `weekly_capacity:3`; `"0"` → `0`; `"-1"` → `ok:false capacity_invalid`; `"2.5"` → `ok:false capacity_invalid`; `"x"` → `ok:false capacity_invalid`.
- `product_types:["rental","house","junk","rental"]` → `["rental","house"]` (normalized, deduped, junk dropped).
- `service_area:"  York Mills  "` → `"York Mills"`; over `MAX_AGENT_FIELD_LEN` → truncated.
- Confirm existing `validateShowingAgent` tests still pass unchanged.

## Verification (Cowork, after Codex builds)
1. `device_bash git diff` review: changes confined to `lib/showing-agents.ts`, `scripts/test-showing-agents.ts`, `app/dashboard/me/page.tsx`, `app/dashboard/me/actions.ts`, `app/dashboard/dashboard-nav.tsx`. No migration; no RLS edit; no change to the org roster, dashboard, availability, or booking/reminder/assignment code. `validateShowingAgent` byte-unchanged.
2. Confirm the update path is self-scoped: the action reads the target id from `user_id = auth uid`, and the `update` carries `.eq("user_id", user.id)` — a member cannot edit another agent's row.
3. **No migration to apply** (0155 already live).
4. Browser QA on Agile (do this **only when Noam lifts the hold / on his go**, operator-facing):
   - As `rentals@` (operator, linked to agent `e1840a30…`): `/dashboard/me` shows the "My coverage" card prefilled from her row; editing service area / product types / weekly capacity and saving persists (verify the row via Supabase; confirm `tier`, `name`, `email`, `user_id` unchanged).
   - As `thadmusco` (owner_admin, no linked agent): `/dashboard/me` shows the "not on the roster" empty state, no form.
   - Nav: "My settings" appears in the account menu on desktop and mobile.

## Standing rules
Codex builds; Cowork verifies the real diff via `device_bash git`; **Noam pushes**; migrations to prod via Supabase MCP (none here). Do not auto-push. The new page + nav item are operator-facing — do not deploy to Agile until Noam lifts the operator hold and gives the go. Never persist tenant PII/secrets.
