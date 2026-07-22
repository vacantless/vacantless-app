# Codex Build Ticket — S499b: Move tenant message templates out of Settings → Communications to point-of-use

**Date:** 2026-07-16 · **Author:** Cowork (grounded against real code on the Mac) · **Status:** IMPLEMENTATION-READY — build on the Mac
**Base:** HEAD `3d9aa22` (S499 Part A, clean tree), migration ledger through `0150`. **NO migration in this slice.**
**Repo:** `.../Agile Lead to Lease Engine/vacantless-app`
**Origin:** Codex Review Verdict P3 UX (2026-07-16): "Settings > Communications is too much of a drawer … tenant message templates feel more like `Tenancies` / `Messages` point-of-use than Settings."

> ### Read this first
> This is a **relocation**, not a redesign or a rewrite. Move the tenant message **template management UI** (list + create/edit/delete) from the Settings → Communications tab to a point-of-use page under Tenancies, reusing the **existing** server actions and table. Leave the org-level *defaults* (email sender, test email, renter messages, arrival phone, SMS) exactly where they are. There is a clean precedent to mirror: the **Lease Clauses** tab was already moved out of Settings to its point-of-use at `app/dashboard/tenants/lease-clauses/` (see the "MOVED OUT of this tab to their point-of-use" comments in `settings/page.tsx:797` and `:1567`). Follow that pattern.

---

## Product goal

Settings should hold **org-level defaults an operator sets once**. Tenant message templates are **authored for sending** — they're used when you open a tenancy and compose a message. Today the full template editor lives in Settings → Communications, making that tab a long scroll (Email sender → test email → renter feedback/follow-up → arrival phone → **tenant templates** → SMS). Move the templates to where they're used; leave a one-line link behind in Settings.

---

## What stays in Settings → Communications (do NOT touch)

The `comms` tab (`app/dashboard/settings/page.tsx`, `tab === "comms"` at L1124) keeps every org-level default, unchanged:
- **Email sender** (reply-to) — h3 `:1131`
- **Send a test email** — h3 `:1183`
- **Renter messages** — h3 `:1253` (Post-viewing feedback `:1279`, Automatic follow-up `:1321`, When they arrive for a viewing / arrival phone `:1346`)
- **Text messages** (SMS) — h3 `:1506`

Do not change the `SettingsTabs` list (`components/settings-tabs.tsx`) — the `comms` tab stays. This slice only removes the **Tenant messages** card from within it.

---

## PART 1 — New point-of-use page (relocate the existing editor)

Create **`app/dashboard/tenancies/message-templates/page.tsx`** (recommended route — co-located with the compose flow at `tenancies/[id]`; see Open Q1). Mirror the Lease Clauses page shape (`app/dashboard/tenants/lease-clauses/page.tsx`): a server component with `getCurrentOrg` + `BrandBanner` header, rendering the template list and forms.

**Relocate, don't rewrite.** Move the existing JSX + data wiring from `settings/page.tsx` (the `id="templates"` card, `:1375`–~`:1504`) to the new page:
- The **templates data load** currently feeding `settings/page.tsx` (the `tenant_message_templates` query → `templates` array). Move that query to the new page.
- The **existing forms** and their server actions **unchanged**: the per-row edit form + delete form (`action={saveMessageTemplate}` / `action={deleteMessageTemplate}`) and the "New template" form (`action={saveMessageTemplate}`, h4 `:1466`).
- The token help copy (`{{first_name}}`, `{{property_address}}`, `{{rent}}`), `MESSAGE_CHANNELS`, and the `tplFlash`/`tplError` success/error banners + the `searchParams.tn` new-form reset key.

**Keep the same server actions** (`saveMessageTemplate`, `deleteMessageTemplate` — imported today into `settings/page.tsx`). The only change to the actions is their **redirect targets**: they currently redirect to `/dashboard/settings?tab=comms…&tpl=…` (the `tpl` flash). Repoint those redirects to the new route (e.g. `/dashboard/tenancies/message-templates?tpl=saved|error`). Locate the two actions (grep `saveMessageTemplate`/`deleteMessageTemplate`; check `app/dashboard/settings/actions.ts` and any tenant-comms actions file) and change only the redirect string. **No change to the table, RLS, columns, validation, or token substitution.**

The `tenant_message_templates` table (migration `0033_tenant_comms.sql`, org-scoped, `tenant_message_templates_org_idx`) and the send path (`tenant_messages` / `tenant_message_deliveries`) are **untouched**. No migration.

---

## PART 2 — Remove the card from Settings, leave a stub link

In `settings/page.tsx`, remove the `id="templates"` **Tenant messages** card (and its now-unused `templates` load, `tplFlash`/`tplError`, and the `saveMessageTemplate`/`deleteMessageTemplate` imports **if** nothing else on the page uses them). In its place, leave a **one-line stub** in the Communications tab pointing to the new page — mirror the existing "MOVED OUT … to point-of-use" stub pattern used for the brand-tab items (`settings/page.tsx:797`, `:805`, `:820`) and Lease Clauses (`:1567`). Example copy: *"Tenant message templates now live with your tenancies → **Manage message templates**"* linking to `/dashboard/tenancies/message-templates`.

Keep the existing "Saved here, used over in Tenancies ↗" intent — but now the management **is** at the point of use, so the new page can carry the reverse hint ("Used from any tenancy: open a tenancy, start a message, pick a template").

---

## PART 3 — Entry points (make it findable at point-of-use)

1. **Tenancy compose flow** — `app/dashboard/tenancies/[id]/page.tsx` (where a template is picked to fill a message): add a **"Manage templates →"** link near the template picker to `/dashboard/tenancies/message-templates`. This is the primary point-of-use entry.
2. **Tenancies index** — `app/dashboard/tenancies/page.tsx`: add a small secondary link/button ("Message templates") in the header actions, mirroring how Lease Clauses is reachable.
3. **Settings stub** (Part 2) — the link left behind.

No new top-level nav item required (Lease Clauses is link-only, not in the primary nav — follow that convention). See Open Q2.

---

## PART 4 — Repoint stale references

Grep and update any link that assumed the editor lived in Settings:
- `grep -rn "#templates" app components lib` and `grep -rn "tab=comms.*templates"` — repoint to the new route.
- Confirm the `tpl` flash param is now read on the new page, not the settings page (the `sender`/`renter`/`sms`/`test` comms flashes stay on the settings page — only `tpl` moves).

---

## PART 5 — Verification (run on the Mac; report results)

No migration. Run:
```
./node_modules/.bin/tsc --noEmit && npm run lint && npm run build
```
Manual QA (dev or a sandbox org — do NOT test-blast Agile tenants):
- New page lists existing templates; create, edit, and delete each work and land back on the new page with the right flash.
- From a tenancy, compose a message and pick a template — still fills correctly (send path unchanged).
- Settings → Communications no longer shows the editor, shows the stub link, and Email sender / test email / renter messages / arrival phone / SMS all still save (their flashes unaffected).
- No broken links to `#templates`.

If any template unit/integration test exists (grep `saveMessageTemplate` in `scripts/`), keep it green and update the expected redirect target.

---

## Open questions for Codex
1. **Route:** `/dashboard/tenancies/message-templates` (co-located with the compose flow) vs mirroring the Lease Clauses location under `/dashboard/tenants/…`. Pick the one most consistent with the existing IA and say which. Templates are org-level (not per-tenancy), so an index-level page under tenancies fits.
2. **Nav:** link-only (like Lease Clauses) vs a small entry in the Tenancies section — your call; link-only is the lighter, precedent-matching option.
3. **Actions location:** confirm where `saveMessageTemplate`/`deleteMessageTemplate` live and that only their redirect targets change (no logic/validation change).

## Explicitly NOT in this slice
No migration. No change to the `tenant_message_templates` schema/RLS, the send path (`tenant_messages`), token substitution, or `MESSAGE_CHANNELS`. No new template features (no versioning, categories, previews). No change to the org-level comms defaults (sender, test email, renter messages, arrival phone, SMS). No `SettingsTabs` change. Do not touch the S499 Part A reschedule work.

## Files expected to change (focused diff)
- **new** `app/dashboard/tenancies/message-templates/page.tsx` (relocated editor + templates load)
- `app/dashboard/settings/page.tsx` (remove the `id="templates"` card + now-unused load/imports; add stub link)
- `app/dashboard/settings/actions.ts` (or wherever the two template actions live) — repoint `tpl` redirects only
- `app/dashboard/tenancies/[id]/page.tsx` (Manage-templates link at the picker)
- `app/dashboard/tenancies/page.tsx` (optional: header link)
- any file referencing `#templates` / `tab=comms…templates`

**Before final, report:** what moved, what stayed, the new route, what passed (tsc/lint/build + manual), and anything intentionally left (e.g. nav choice).
