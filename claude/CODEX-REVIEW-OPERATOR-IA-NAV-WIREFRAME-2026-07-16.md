# CODEX REVIEW — Operator IA / Navigation restructure (target-IA, PRE-BUILD) — 2026-07-16

**Type:** Design review, READ-ONLY. Do **not** write code, do not open PRs, do not edit files. Produce a written verdict + a file-level move list. Mirrors the S488 command-center design review (which you ACCEPTED with no P1/P2 blockers) and the S225 Settings-by-intent audit.

**What to look at:**
- `claude/VACANTLESS-OPERATOR-IA-NAV-WIREFRAME-2026-07-16.html` — the clickable target-IA wireframe. All findings + annotations are inline in the HTML source (read the text of the `.anno`, `renderX()` functions, and the move-map table). It has a Before mode (today) and an After mode (proposed).
- The **live repo** — the actual Settings / Notifications / Dashboard / Banking&Rent / Distribution code — to confirm the current-state facts below and judge feasibility.

## The proposal (what the wireframe locks)
Restructure the Settings / Dashboard / Operator surfaces so IA follows **user intent, not the form/table that persists each control** (the `feedback_settings_organize_by_intent` principle; precedent = S499b tenant-template move, commit b8a3ac3, Settings→Communications → `/dashboard/tenancies/message-templates`, link-only).

Target split:
- **Global (Org) Settings** = brand/public identity, org contact defaults, email/SMS defaults, integrations/API keys, billing/plan, account-level notification *defaults* only. Point-of-use editors leave; stub links stay.
- **Automations & Templates** (NEW admin surface) = the entire Notifications editor, extracted from Settings, link-only from Settings. **← Slice 1.**
- **My settings** (NEW personal/operator surface, off the account menu) = personal notification prefs, my viewing coverage, my defaults (default dashboard filter). Requires an operator-vs-org data-model decision.
- **Dashboard = command center** = a "Needs me now" action-queue across leasing, money, rent, tenant-message approvals, maintenance, tenancy tasks, distribution readiness + a "my assigned today ⇄ whole team" toggle. Stays action-only (no setup/reference).
- **Money & Rent** = the operational half of today's "Banking & Rent" settings tab (CSV exports + rent records) re-homed next to the work; setup half (API keys / connect-disconnect) stays in Settings → Integrations.

## Current-state facts to VERIFY against the code
1. **Notifications** is effectively an admin automation/template *studio* living inside the Settings page (~27,684 px tall, ~40 forms, ~361 inputs on the Agile admin account). Confirm: which route/component renders it, and roughly the form/input count.
2. **Banking & Rent** settings tab mixes setup (bank connection / API keys / connect-disconnect) with operations (CSV exports + rent records). Confirm the split is real in code.
3. **No personal/operator settings surface** exists; account menu = Settings / Your plan / Refer a landlord / Captures / Sign out. Showing-agent setup is team/global assignment, not personal. Confirm.
4. **Dashboard** is leasing-only (inquiries-to-reply / viewings-today / assigned-viewings-awaiting-confirmation / renters-by-stage / upcoming / recent). Confirm it has no money/rent/maintenance/approval/tenancy/distribution queues today.

## Deep-dive: Slice 1 (Notifications extraction) — the part we want to build first
Give a concrete, file-level move plan and a feasibility verdict. Specifically:
- **Which page/route renders the Notifications editor today**, and every server action / lib that reads & writes it (the notification substrate — `lib/notifications*`, event model, any `event_key` handling).
- **What a link-only stub in Settings looks like** after extraction (mirror S499b: Settings keeps org *defaults* + a stub link; the editor moves to the new route). List the exact files touched, routes added, nav/link changes.
- **Migration?** S499b needed none. Confirm whether extracting Notifications needs any schema/migration or is pure route/component relocation + a nav link.
- **Invariants at risk** — anything that must be preserved byte-for-byte (event definitions, CRON/reminders wiring, recipient resolution, the free-text `event_key` model since 0067, approval-queue notices). Flag anything the move could silently break.
- **Nav placement** — should Automations & Templates be a top-level sidebar item (as the wireframe shows) and/or an account-menu item? Recommend.

## What to produce
1. **Verdict on the target IA**: ACCEPT / ACCEPT-WITH-CHANGES / REJECT, with any **P1/P2 design blockers** called out (P3 nits welcome but separate).
2. **Slice 1 file-level move list** — the exact files/routes/actions to change, whether a migration is needed, and the invariants to preserve. Detailed enough to become a build ticket.
3. Any current-state fact above that the code **contradicts** (so we correct the wireframe before building).

## Out of scope
Do not build anything. Slices 2 (Banking/Rent split), 3 (Dashboard command center), 4 (My-settings surface), 5 (Distribution) are later and each gets its own design pass — only review their target-split feasibility at a high level; the detailed plan we need now is Slice 1.
