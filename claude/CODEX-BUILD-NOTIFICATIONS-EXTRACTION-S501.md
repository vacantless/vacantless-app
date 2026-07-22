# CODEX BUILD — Notifications → Automations & Templates (extraction) — S501

**Slice 1 of the Operator IA restructure.** Design accepted by Codex (ACCEPT-WITH-CHANGES, no P1 blockers) on the target-IA wireframe (`claude/VACANTLESS-OPERATOR-IA-NAV-WIREFRAME-2026-07-16.html`) + review ticket (`claude/CODEX-REVIEW-OPERATOR-IA-NAV-WIREFRAME-2026-07-16.md`). This is a **re-home/rename**, mirroring the S499b tenant-template move (Settings → point-of-use, link-only stub, no migration). **UI/route relocation only — no behavior change, no migration.**

## Why
The notification editor is an automation/template *studio* (41 active events/forms, ~329 rendered controls + a cadence select) currently reachable as a **Settings tab** (`components/settings-tabs.tsx:32`) pointing at its own nested route `/dashboard/settings/notifications`. It is not org *setup* — it's an admin surface in its own right. Per `feedback_settings_organize_by_intent`, give it a top-level home (**Automations & Templates**) and leave Settings a link-only stub. Settings keeps only org notification *defaults*.

> **Corrected from the wireframe's first draft (Codex-verified):** Notifications is NOT an embedded scroll inside the 1,574-line main Settings page — it is already a separate nested route (`app/dashboard/settings/notifications/page.tsx`, ~405 lines). So this slice moves an existing standalone page up to a top-level route and de-tabs it; it does not carve a giant form out of Settings.

## Exact changes (files)
1. **Move the page.** `app/dashboard/settings/notifications/page.tsx` → `app/dashboard/automations/page.tsx`. Content unchanged except any self-referential `/dashboard/settings/notifications` strings/links → `/dashboard/automations`.
2. **Move the actions.** `app/dashboard/settings/notifications/actions.ts` → `app/dashboard/automations/actions.ts`.
3. **Repoint `BASE`.** In the moved actions, change `const BASE = "/dashboard/settings/notifications"` (line 14) → `"/dashboard/automations"`. This single change carries every internal redirect + `revalidatePath(BASE)` + `requireCapability(..., \`${BASE}?error=forbidden\`)` (lines 26/31/40/47/65/79/84/85). **Preserve all other logic byte-for-byte** (capability gate `manage_settings`, `isNotificationEventKey` validation, color/save error codes, save/redirect flow).
4. **Compatibility redirect.** Add `app/dashboard/settings/notifications/page.tsx` as a thin server redirect → `/dashboard/automations` (preserve query string if cheap), so bookmarks/old links/emails don't 404.
5. **De-tab it.** Remove the `notifications` entry from `components/settings-tabs.tsx` (line 32) and the `"notifications"` member from its tab-key union (line 16) if it becomes unused.
6. **Settings stub (mirror S499b).** In the Settings communications/notifications area, add a link-only stub: *"Notification automations and templates now live in **Automations & Templates**."* → link to `/dashboard/automations`. Settings retains only org notification **defaults** (if any live there today; do not move those).
7. **Navigation.**
   - **Now (current topbar app):** add **Automations & templates** to the org/account menu, next to Settings.
   - **Future sidebar IA:** it becomes a top-level **Admin** item (per the wireframe). Add now only if the sidebar exists; otherwise the account-menu entry is sufficient for S501.
8. **Copy sweep.** Update any user-facing text that says "Settings → Notifications" in tenancy/property sections (and email/help copy) to "Automations & Templates". Grep `Settings → Notifications`, `settings/notifications`, and "Notifications settings".

## No migration
Pure route/component relocation. **Do NOT touch** `notification_settings`, `event_key`, `organizations.outcome_nudge_max`, `compliance_reminder_log`, `pending_tenant_messages`, or any schema.

## Invariants — preserve byte-for-byte
- `NOTIFICATION_EVENTS` keys / defaults / `sendMode` / tokens.
- Free-text `event_key` model (no CHECK constraint, since 0067).
- Absent-row defaults (an event with no `notification_settings` row still resolves to its default).
- `isDripEnqueueEnabled` opt-in behavior.
- Recipient resolution (incl. operator-fallback recipients).
- `sendOrgNotification` never-throw semantics.
- CRON event keys (reminders.yml / cron routes reference the same keys).
- Approval-queue "draft first, human sends" behavior.
- The `manage_settings` capability gate on every write.

## Verification plan
- `tsc --noEmit` + lint + `next build` clean on the Mac (Noam runs the gate).
- Existing notification tests stay green (notifications / reminders suites) — this is UI/route-only, no lib behavior change; add none unless a helper is extracted.
- Cowork verifies the diff via `device_bash git` in MAIN context (file moves + the single `BASE` change + tab removal + stub + redirect; confirm 0 changes to `lib/notifications*`, `NOTIFICATION_EVENTS`, and no migration file).
- Live read-only QA (Claude-in-Chrome) on Agile/North Star: `/dashboard/automations` renders the full editor; save works; `/dashboard/settings/notifications` 302s to it; the Settings tab is gone and the stub link is present; account menu shows Automations & templates.

## Out of scope (later slices, rebased on current code)
- **Slice 2 — Money/Rent:** `/dashboard/money` and `/dashboard/rent` already exist; consolidate/rename/re-home duplicates + pull CSV export + rent records out of the Settings Banking&Rent cards (`rotessa-settings-card.tsx:143`, `stripe-connect-settings-card.tsx:186`), keeping bank connection/API keys in Settings. Not this ticket.
- **Slice 3 — Dashboard command center:** the dashboard already has a cross-workstream Today lane (`app/dashboard/page.tsx:54` reads `pending_tenant_messages`, work orders, rent-increase alerts). Real delta = add distribution readiness + expense/money review + a "my assigned ⇄ team" model. Needs the operator-vs-org decision. Not this ticket.
- **Slice 4 — My settings (operator surface)** and **Slice 5 — Distribution.** Later.
