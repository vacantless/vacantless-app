# DESIGN — IA Slice 2: Banking & Rent split (Vacantless) — 2026-07-16

**Slice 2 of the Operator IA restructure** (`IA-AUDIT-SETTINGS-DASHBOARD-OPERATOR-2026-07-16.md`). Slice 1 shipped as S501 (Notifications → `/dashboard/automations`); S499b (tenant templates → point-of-use) was the first move. This is **design-first**, one slice, Codex-reviewable before code. Build ticket = `CODEX-BUILD-IA-BANKING-RENT-SPLIT-S505.md`.

Grounded live against `HEAD = 1581473` (`main`, S504). Line numbers at that SHA.

## The finding (corrected from the audit's first draft)
The audit said "re-home CSV export + rent records out of the Settings bank cards into Money/Rent." A live read shows the re-home is **already half-done** and the real problem is now **duplication**, not misplacement:

- **The Money hub already owns exports.** `app/dashboard/rent/page.tsx` (the "Money" hub, S274) has an **"Export your records"** card (lines ~83–116) with three CSV links: **Owner statement CSV** (`/dashboard/rent/statement/export`), **Rotessa rent CSV** (`/dashboard/rent/export`), **Stripe payouts CSV** (`/dashboard/rent/stripe-export`). These are plain `<a>` links → **all-time** exports (no date filter).
- **The two Settings → Banking cards still embed their own export UI too**, and their version is *richer* — it carries a **From/To date-range filter**:
  - `components/rotessa-settings-card.tsx:135–156` — "Export rent payments" `<form method="get">` → `/dashboard/rent/export` with `from`/`to` date inputs.
  - `components/stripe-connect-settings-card.tsx:176–200` — "Export rent invoices" `<form method="get">` → `/dashboard/rent/stripe-export` with `from`/`to` date inputs (gated `state === "ready"`).

So the same operational export exists in **two places**, and the Settings cards — which should be pure **setup** (connect / rotate key / disconnect) — carry an **operational** control. That's the exact "setup vs operations" smell the audit flagged. The endpoints themselves already live correctly under `/dashboard/rent/*`; only the *entry-point UI* is mis-placed and duplicated.

## Target
- **Settings → Banking cards** = setup only: connection status, connect / disconnect, replace/rotate API key + environment. **No export UI.**
- **Money hub (`/dashboard/rent`)** = the single home for exports, and it **keeps the date-range capability** (moved from the cards, not dropped) so no feature is lost in the re-home.

## The one design decision — preserve the date filter
A naïve "delete the card export blocks" would silently lose the From/To filter (the hub links are all-time). A re-home must **move, not drop**. So the hub's export card is upgraded: Owner statement stays a link; **Rotessa rent CSV** and **Stripe payouts CSV** each become a small `From / To / Download CSV` GET form (the same markup the cards had, blank = everything), pointing at the same two endpoints. The hub is a server component with `force-dynamic` — plain GET forms need no client state, so this is a pure-markup lift.

Not gating by connection state on the hub: the export routes already self-handle the not-connected case (bounce to Banking settings) — the existing hub comment says so — so the forms stay always-visible, consistent with today's hub links.

## Explicitly OUT of scope for S505 (keep the slice small)
- **`/dashboard/money` vs `/dashboard/rent` naming/route consolidation.** Both exist; the audit notes the duplication. Renaming/redirecting a nav route is a separate, higher-risk change — defer to its own slice. S505 touches only the export UI.
- Any change to the CSV **endpoints/handlers** (`/dashboard/rent/export`, `/stripe-export`, `/statement/export`) — untouched.
- Slices 3 (dashboard command-center cards) and 4 (operator/user settings surface) — both need the operator-vs-org data-model decision; not this slice.

## Why this is a safe slice
Pure UI re-home: move ~22 lines of JSX out of two Settings cards, upgrade one hub card's three links into two date forms + one link. No migration, no data-model change, no endpoint change, no notification/settings-schema change. Feature parity preserved (date filter kept). Fully reversible. Regression surface = the rent test suite + tsc/lint/build + a browser pass on Banking cards and the Money hub.
