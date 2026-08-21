# CODEX PROMPT — Slice 3 naming SPLIT (KI969) — S603

Prod baseline: app HEAD **d762047** (S602 LIVE). This is a **source-only UI/IA lane**.
Cowork has applied the diff and is holding it UNCOMMITTED for your review → lint → tests →
build → commit → push → prod-smoke. Do NOT reopen deploy/DB/env/flag/live-send lanes.

## Why (KI969)
The Automations page is already titled **"Messages & reminders"** and owns the actual
editable message CONTENT (every notification event: on/off, recipients, subject, body,
cadence — incl. the S602 basic-mode `<details>`). The Settings **"Communications"** tab
holds only *setup/plumbing* (sender identity, SMS connection, viewing-confirmation +
auto-close rules, the compliance enable toggle) plus the S605 owner-admin feature flags.
Both surfaces were competing for the "Messages & reminders" name. Resolution = split on the
**messages vs. setup** axis. No message content moves (it already lives on the reminders page).

## Held diff (4 files, tsc-clean; git diff --stat = 4 files, +135/-120)
1. **components/settings-tabs.tsx** — Settings tab label `"Communications"` → **`"Message setup"`**.
   Tab KEY stays `comms`; route `/dashboard/settings?tab=comms` UNCHANGED.
2. **app/dashboard/settings/page.tsx**
   - Moved the S605 **"Account features"** owner-admin panel (and its `featuresFlash === "forbidden"`
     banner) OUT of the Communications tab and INTO the **"Plan & admin"** (`tab === "account"`) tab,
     as the first block. Audit-mandated (Feature access → Plan & admin). Everything else in the
     comms tab (Email sender / Renter messages / Viewing confirmation / Auto-close / Compliance
     calendar toggle / Text messages) stays put.
   - `resolveTab`: `features` flash now infers **account** (was comms).
   - Cross-link card copy: "Notification automations and templates now live in **Automations &
     Templates**" → "The reminders and messages you send now live in **Messages & reminders**"
     (href `/dashboard/automations` unchanged).
   - Flash-param comment updated (cosmetic).
3. **app/dashboard/settings/actions.ts** — `updateOrganizationFeatureFlag`: all 4 redirects
   `?tab=comms&features=…` → `?tab=account&features=…` (forbidden/invalid/error/saved) so the save
   lands the operator back on Plan & admin. No entitlement-resolver logic changed.
4. **app/dashboard/automations/page.tsx** — added `import Link from "next/link";` and a reciprocal
   muted line under the intro box: "Looking for the sending address, text messaging, or
   viewing-confirmation rules? Those live in **Settings → Message setup**"
   (href `/dashboard/settings?tab=comms`).

## Verification already done (Cowork, device Linux VM)
- `npx tsc --noEmit`: 0 real errors. The 146 emitted errors are ALL `TS6053` for stale
  `.next/types/app 2/**` (the pre-existing "app 2" dupe cache, KI971) — none reference the 4
  edited files. Confirm on macOS after a clean `.next`.
- Structural checks pass: "Account features" now renders only in the account tab (not comms);
  comms still has Email sender; resolveTab routes features→account; actions have 4 account
  redirects / 0 comms; tab label = "Message setup"; old "Automations & Templates" label gone;
  automations reciprocal Link present.
- `grep scripts/` — NO focused test asserts any changed label (only an unrelated "Rogers
  Communications" merchant string in test-categorization-rules.ts). Nothing should regress.

## You (Codex) do
- Review the 4-file diff. Run `npm run lint` (expect the known unrelated `<img>` warning only).
- Run focused suites: `npx tsx scripts/test-notifications.ts`,
  `npm run test:selected-org-dashboard-scope`, and `npx tsx scripts/test-compliance-calendar.ts`
  (compliance toggle sits next to the moved block — prove it still renders/gates).
- `npm run build` (expect 69 pages).
- `git diff --check` + staged `--check`. **Commit by explicit path, NOT `git add -A`** (untracked
  `claude/*.md` prompts + a pre-existing `_gitlock_quarantine/` dir are NOT part of this change).
  Suggested message: `feat: split messages page from message setup (KI969 naming)`.
- Push to `main`, confirm the deploy READY via Vercel, prod-smoke: Settings tabs read
  Public page / Rental site accounts / **Message setup** / Banking & rent / Plan & admin;
  Account features renders under Plan & admin and saving it lands back on Plan & admin;
  Automations page shows the reciprocal "Settings → Message setup" link.

## Preserve (do NOT change)
- S605 feature-entitlement resolver behavior; S604 compliance property-eligibility gates; S603
  approve-before-send boundary; S602 compliance org toggle; all carried production gates.
- Every route URL (tab keys unchanged). No migrations, no env flips, no org feature-flag writes,
  no live sends.

## Acceptance (audit Slice 3 + the split)
- Two surfaces, two clear names: "Messages & reminders" = the messages; "Message setup" = the
  setup behind them. Owner-admin feature flags no longer sit inside a communications tab.
- Existing automation rows still save exactly as before; compliance disabled-state stays honest.
