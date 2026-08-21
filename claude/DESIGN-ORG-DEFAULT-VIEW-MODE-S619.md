# DESIGN — Org-level default Get-online view mode (S619 fast-follow)

**Author:** Cowork (design pass, pre-build)
**Date:** 2026-08-03
**Prod baseline:** `81d3312` (S618 ESL simple-mode + delete/archive LIVE)
**Status:** DESIGN + build-ready. Ships via the Codex warm-verify loop (WORKFLOW 206), one file-disjoint lane. The Codex prompt is `claude/CODEX-PROMPT-ORG-DEFAULT-VIEW-MODE-S619.md`.

---

## 1. Why

S618 shipped the Get-online **Simple mode** as the default, with the full command center behind an "Advanced tools →" toggle. Persistence is **localStorage only** (`vacantless.getonline.mode`), which is per-browser: a power operator (Agile / Noam) who lives in Advanced has to flip the toggle again on every new browser or after clearing storage, and a brand-new device always lands them in Simple.

The S618 design (§8, decision 1) and the S618 memory both flagged the fix as the recommended fast-follow: an **org-level default** (`organizations.distribution_view_mode`) so a power org auto-lands in Advanced, while the ESL/self-managing default stays Simple. localStorage already covers the common per-browser case; this adds the org-scoped default underneath it.

## 2. Precedence (the one real decision)

Three sources, most-specific wins:

1. **Explicit per-browser toggle** (`localStorage['vacantless.getonline.mode']`) — the operator clicked "Advanced tools →" or "← Simple view" on *this* browser. Always wins.
2. **Org default** (`organizations.distribution_view_mode`) — set once for a power org so every fresh browser lands in the right place.
3. **Hardcoded fallback** — `simple` (unchanged S618 behavior when the column is null and no localStorage key exists).

Rationale: the org default seeds the *initial* mode; an explicit per-browser choice is a stronger signal of intent and overrides it on that browser. This means a power-org operator who deliberately switches one browser to Simple (e.g. to demo the ESL flow) keeps Simple there, which is correct.

**SSR / hydration:** the org default is known server-side, so it is passed as a prop and used as the `useState` initializer. SSR and the first client render both use the prop → no hydration mismatch. The localStorage override runs in `useEffect` after mount (a one-frame swap only when localStorage disagrees with the org default — rare, and identical in spirit to today's simple→advanced swap).

## 3. Data model

- **Migration 0209** (next free; 0208 is the highest on disk + applied to prod): add `distribution_view_mode text` to `public.organizations`, nullable, default `null`, with a CHECK constraint restricting it to `('simple','advanced')`. No index (always read by `organizations.id`, already the PK).
- `null` = no org default → falls through to localStorage → `simple`. Non-breaking for all existing orgs.

## 4. Read + thread (file-local)

- **`[id]/page.tsx`** — source the viewing operator's org default. The viewer's org is already loaded via `getCurrentOrg()` (line ~528, exposes `booking_timezone`/`plan`). Prefer sourcing `distribution_view_mode` from that already-loaded `org` if the helper's select exposes it after the migration; otherwise do a small targeted read mirroring the concierge block (`.from("organizations").select("distribution_view_mode").eq("id", <viewer org id>).maybeSingle()`, lines ~1466-1470). Compute `orgDefaultMode: "simple" | "advanced" | null` and pass it to `<DistributeTab>`.
  - Source from the **viewer's** org (the person choosing a default view), not `propertyOrgId` — they can differ for a shared/network property, and the preference belongs to the viewer.
- **`[id]/distribute-tab.tsx`** — accept an `orgDefaultMode` prop and forward it to `<GetOnlineView orgDefaultMode={...}>`. Pure passthrough; no other change.
- **`[id]/get-online-view.tsx`** — accept `orgDefaultMode?: "simple" | "advanced" | null`; initialize `useState<Mode>(orgDefaultMode === "advanced" ? "advanced" : "simple")`; in the existing `useEffect`, honor localStorage **both** ways (`saved === "advanced"` → advanced; `saved === "simple"` → simple) so the explicit-toggle override still wins now that the initial value can be advanced.

## 5. How an org's default gets set (MVP = SQL, no UI)

The stated goal is "power orgs (Agile) auto-land in Advanced" — a one-time set for a small number of orgs. MVP = a SQL update, no settings UI:

```sql
update public.organizations set distribution_view_mode = 'advanced' where id = '<Agile org id>';
```

This is applied deliberately by Noam/Cowork after the migration + deploy land (it is a live-org write; treat like other Agile queued changes). A per-org settings toggle ("Default this org to Advanced tools") is a clean **fast-follow** if self-serve control is ever wanted, but is out of scope for this lane — it would touch the settings surface and widen the blast radius.

## 6. Scope guards

- **Reuse, don't rebuild.** Net-new = one nullable column + one prop threaded through two components + a two-line initializer/effect change. No change to the distribution engine, server actions, Simple/Advanced trees, or the S618 delete/add-property lanes.
- **Do NOT** change the localStorage key or the S618 toggle UI/behavior.
- **Do NOT** add a settings UI this lane (SQL-set for MVP).
- **Do NOT** default any org to advanced in the migration — the column ships null (all orgs unchanged); Agile is set explicitly afterward.

## 7. Verification

- `tsc` / `lint` / `build` / `git diff --check` / tests all green.
- **Migration-before-deploy:** apply 0209 to prod via Supabase MCP + SQL readback (column present, CHECK enforced, defaults null for all orgs) BEFORE the code deploy — same order as every prior lane.
- **Dogfood (North Star QA via Claude-in-Chrome):**
  - Fresh browser (clear `vacantless.getonline.mode`) on an org with `distribution_view_mode = null` → Get-online lands in **Simple** (unchanged).
  - Set the QA org's `distribution_view_mode = 'advanced'` via SQL → fresh browser now lands in **Advanced** with no flash; localStorage empty.
  - Click "← Simple view" → lands Simple + persists on reload (explicit toggle beats org default on this browser).
  - Clear localStorage again → back to Advanced (org default reasserts).
  - Confirm no hydration warning in console on either mode.
- **Set Agile** `distribution_view_mode = 'advanced'` only after dogfood passes (Noam's go — live-org write).

## 8. Open decision for Noam

- **Set-mechanism:** SQL-set for Agile now (MVP, recommended) vs build a per-org settings toggle (fast-follow). Rec: SQL now; add the toggle only if a second org wants self-serve control.
