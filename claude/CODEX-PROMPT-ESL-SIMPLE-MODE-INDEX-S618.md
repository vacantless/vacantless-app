# CODEX INDEX — S618: ESL Simple Mode + Delete/Archive (3 lanes)

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-08-03
**Prod baseline:** `a4fefdd`. **Design of record:** `claude/DESIGN-ESL-SIMPLE-MODE-AND-DELETE-S618.md` — read it first for the "why" and the full strategy.

This is the entry point. It dispatches **three file-disjoint lanes**, each with its own self-contained prompt in this same `claude/` folder. **Do each lane on its own branch, as its own single clean commit, and report back per lane. Do NOT push. Do NOT run migrations** (Cowork applies migration 0208 to prod + readback, then Noam file-scoped pushes each lane).

## The three lane prompts (read each in full before building it)
1. **Lane 1 — Delete / Archive a listing** → `claude/CODEX-PROMPT-DELETE-ARCHIVE-LISTING-S618.md`
   Adaptive per-row control on the rentals list; hard delete only for a draft/off-market unit with no leads/tenancy/posts (server-authoritative guard), archive (hide, recoverable) otherwise. **Migration 0208 (`properties.archived_at`) — author the file only.** Files: `app/dashboard/properties/page.tsx`, `app/dashboard/properties/actions.ts`, one new client component, `supabase/migrations/0208_*.sql`.
2. **Lane 3 — Collapse add-property detail** → `claude/CODEX-PROMPT-ADDPROPERTY-COLLAPSE-DETAIL-S618.md`
   Collapse the optional "detailed" block on `/properties/new`, surface the buried Photos input. Presentation only. File: `app/dashboard/properties/new/add-property-form.tsx`.
3. **Lane 2 — Get-online Simple mode (headline)** → `claude/CODEX-PROMPT-GETONLINE-SIMPLE-MODE-S618.md`
   Default Simple mode (6-step inline spine) + Advanced toggle preserving today's command center; connect-accounts promoted to an explicit step. Reorganize + reuse — do NOT rebuild the distribution engine. Files: `app/dashboard/properties/[id]/distribute-tab.tsx` (+ small wiring in `[id]/page.tsx`, possibly one new client component).

## Order & independence
- The lanes touch **disjoint files** and can be built independently.
- **Recommended order: 1 → 3 → 2** (two low-risk isolated lanes first, then the medium-risk headline). Lane 2 open question is called out inside its own prompt (whether the account-connect flow renders inline or is Settings-only) — inspect `launch-run-panel.tsx` and follow that prompt's fallback.
- Only **Lane 1** has a migration. Lanes 2 & 3 have none.

## Shared guardrails (apply to every lane)
- Per lane, all gates must pass and be reported **verbatim with counts**: `npx tsc --noEmit` (0 errors) · `npm run lint` (clean; note new warnings on touched files) · `npm run build` (succeeds) · `git diff --check` (clean) · `npm run test` (green, counts).
- **Commit touched/new files BY NAME** — never `git add -A`. The working tree has untracked `claude/*.md` + a `_to_delete/` dir that must NOT be swept into any commit.
- One branch + one clean commit per lane; use the commit message given at the bottom of each lane prompt.
- **Do NOT push. Do NOT run the migration.** Reply per lane with: branch, SHA, diffstat, every gate result, and (Lane 1) the migration filename.
- Do not widen a lane's scope into another lane's files. If a lane needs a shared helper, keep it local and minimal.

## After Codex reports
Cowork warm-verifies each lane against a prod clone, applies migration 0208 to prod + SQL readback (Lane 1) **before** the Lane 1 deploy, then Noam file-scoped pushes one lane at a time in the recommended order.
