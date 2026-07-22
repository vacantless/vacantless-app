# CODEX BUILD — IA Slice 2: Banking & Rent split — S505

**Slice 2 of the Operator IA restructure** (`IA-AUDIT-SETTINGS-DASHBOARD-OPERATOR-2026-07-16.md`; design = `DESIGN-IA-SLICE2-BANKING-RENT-SPLIT-2026-07-16.md`). Slice 1 = S501 (shipped). This is a **pure UI re-home** — no migration, no endpoint change, no data-model change.

Grounded against `HEAD = 1581473` (`main`, S504). Line numbers at that SHA — re-anchor by the quoted markers before editing (do not trust raw line numbers if the tree has moved).

## Why
The rent CSV export UI is **duplicated**. The Money hub (`app/dashboard/rent/page.tsx`) already has an "Export your records" card, **and** both Settings → Banking cards embed their own export forms. The Settings cards should be **setup only** (connect / rotate key / disconnect); the export is an **operational** control that belongs on the Money hub. The cards' version additionally carries a **From/To date filter** the hub links lack — so the fix is: move the date-filter export onto the hub (feature parity), then delete the export blocks from both cards.

## Change 1 — remove the export block from the Rotessa card
`components/rotessa-settings-card.tsx` — delete lines **135–156** (the `{/* Export rent payments ... */}` comment through its closing `</div>`), plus the now-orphaned blank line. Result: the connected-state column goes straight from the Disconnect form (`</div>` at 133) to the `{/* Replace / rotate the stored key */}` `<details>` (158).
- **Keep** the `SECONDARY_ACTION_CLASS` import (line 15) — still used by the Disconnect button (line 120).
- Do not touch `RotessaAccountView`, the connect form, or any props.

## Change 2 — remove the export block from the Stripe card
`components/stripe-connect-settings-card.tsx` — delete lines **176–200** (the `{/* Export rent invoices ... */}` comment through the `)}` that closes the `{state === "ready" && ( … )}` wrapper). Result: the connected column's `</div>` (174) is followed directly by the closing `</div>` (201).
- **Keep** the `SECONDARY_ACTION_CLASS` import (line 18) — still used at line 161.
- After removal, confirm `state` (and any other locals) are still referenced elsewhere; if the deletion orphans a variable/import, clean it up. Do not change the Stripe connect state machine otherwise.

## Change 3 — upgrade the Money hub export card to keep the date filter
`app/dashboard/rent/page.tsx`, the "Export your records" `Card` (the three `<a>` buttons at ~lines 95–113). Keep **Owner statement CSV** as the existing `<a href="/dashboard/rent/statement/export">` link. Replace the **Rotessa rent CSV** and **Stripe payouts CSV** `<a>` links with small inline **GET forms** carrying `from`/`to` date inputs (moved from the deleted card blocks), pointing at the same endpoints:
- Rotessa → `<form action="/dashboard/rent/export" method="get">` with `<input type="date" name="from">` / `name="to"` + a "Rotessa rent CSV" submit.
- Stripe → `<form action="/dashboard/rent/stripe-export" method="get">` with the same two date inputs + a "Stripe payouts CSV" submit.
- Blank dates = everything (unchanged endpoint behaviour). Reuse the hub's existing button/label Tailwind classes for visual consistency (the page is a server component — plain GET forms, no client state, no `"use client"`).
- Layout: a short helper line ("Leave dates blank for everything.") is fine; keep it compact so the card doesn't dominate the hub.

## Invariants (do not change)
- **No endpoint/handler edits**: `app/dashboard/rent/export`, `/dashboard/rent/stripe-export`, `/dashboard/rent/statement/export` are untouched. This slice only moves the *entry-point UI*.
- **No migration, no schema/settings-shape change, no notification-events change.**
- Feature parity: the From/To date filter that existed on the Settings cards now exists on the hub — nothing is dropped.
- Do not rename or redirect `/dashboard/money` ↔ `/dashboard/rent` (explicitly deferred to a later slice).
- Settings → Banking cards remain fully functional for connect / disconnect / rotate-key after the export blocks are removed.

## Verification
- `tsc --noEmit` + `next lint` + `next build` clean (Noam runs the gate). No new `"use client"`; no unused imports/vars left by the deletions.
- Regression: existing rent test suite still green — `scripts/test-rent-roll.ts`, `test-rent-receipt.ts`, `test-stripe-rent-update.ts` (these exercise rent/export logic paths, which are unchanged; they should be unaffected). No new test needed (pure presentational move) — but if any test imports the two card components' export markup, update it.
- Browser pass (Noam / Cowork on Agile, `plan=growth`):
  1. Settings → Banking: both cards show status + connect/disconnect + replace-key, and **no** "Export …" block.
  2. Money hub (`/dashboard/rent`): "Export your records" shows Owner statement CSV (link) + Rotessa and Stripe **From/To + Download** forms; a download with blank dates returns all-time CSV; a download with a date range respects it (same as the old card forms did).
- Cowork verifies the diff via `device_bash git` in MAIN: only `components/rotessa-settings-card.tsx`, `components/stripe-connect-settings-card.tsx`, and `app/dashboard/rent/page.tsx` change. Net deletions in the two cards; a small net change in the hub. No migration file, no route/handler file, no `.github/workflows` change.

## Deploy sequencing
No migration, no env, no data-model dependency → **push whenever**. Nothing is customer-facing-gated (this is operator-facing UI only; no renter emails/SMS), so no Noam go-ahead is needed beyond the normal push. Verify Vercel READY, then browser-check the two surfaces above.

## Done =
Settings Banking cards are setup-only; the Money hub is the single, date-filter-capable home for rent exports. Slice 2 of the IA restructure ships; Slices 3–4 (dashboard command-center cards; operator/user settings) remain design-first and blocked on the operator-vs-org model.
