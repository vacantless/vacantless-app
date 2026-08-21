# CODEX PROMPT — Fix scheduled/sent tenant-message time shown in UTC not org timezone (S612)

## Context (verified by Cowork S612, 2026-08-02)
The tenant-comms outbox went LIVE this session (TENANT_COMMS_OUTBOX_ENABLED=true, prod redeploy
dpl_3otTD1FjoYm9TySN3oQgwvnD3qLT of fa01b09). During the live dogfood we found a **display bug**:
the "Scheduled messages" list on the tenancy page shows the send time in **UTC**, not the operator's
local/org timezone. A message the operator scheduled for **12:00 PM** (entered in a browser-local
datetime-local input, stored 16:00 UTC) was listed as **"4:00 PM"**.

Root cause: `app/dashboard/tenancies/[id]/page.tsx` is a **Server Component**, so a bare
`new Date(iso).toLocaleString()` formats in the SERVER's zone (UTC). The same latent issue is on the
Sent-history line right below it (`created_at`). The scheduling/dispatch logic itself is CORRECT
(scheduled_send_at is stored as the right UTC instant, verified via SQL) — this is DISPLAY-ONLY.

Fix = format in the org's `booking_timezone` (already loaded on the page via `getCurrentOrg()`;
falls back to "America/Toronto", the app-wide default). Cowork already built + verified this exact
change against a prod clone at fa01b09: `tsc --noEmit` clean whole-tree, and a runtime check confirms
16:00 UTC -> "Aug 5, 2026, 12:00 p.m." in America/Toronto (and "9:00 a.m." in America/Vancouver).

## Apply this exact diff (2 files, +22/-3). Do NOT touch package-lock.json.

### 1) lib/tenant-comms.ts — add a pure helper right after `channelLabel()`:
```ts
/**
 * Format a UTC timestamp for display in the operator's org timezone.
 *
 * The tenancy page is a Server Component, so a bare
 * `new Date(iso).toLocaleString()` renders in the SERVER's zone (UTC) and shows
 * the wrong wall-clock time — e.g. a message the operator scheduled for 12:00 PM
 * (entered in a browser-local datetime-local input) appeared as "4:00 PM" (16:00
 * UTC). Formatting with the org's booking_timezone reconciles the displayed time
 * with what the operator actually entered. Falls back to America/Toronto (the
 * app-wide default org timezone). Pure.
 */
export function formatCommsDateTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-CA", {
    timeZone: timeZone || "America/Toronto",
    dateStyle: "medium",
    timeStyle: "short",
  });
}
```

### 2) app/dashboard/tenancies/[id]/page.tsx
Update the import (line ~75):
```
-import { channelLabel, commsErrorMessage } from "@/lib/tenant-comms";
+import { channelLabel, commsErrorMessage, formatCommsDateTime } from "@/lib/tenant-comms";
```
Scheduled-messages list (line ~2637):
```
-                        {channelLabel(m.channel)} · {new Date(m.scheduled_send_at).toLocaleString()}
+                        {channelLabel(m.channel)} · {formatCommsDateTime(m.scheduled_send_at, org?.booking_timezone ?? "America/Toronto")}
```
Sent-history line (line ~2673):
```
-                        {channelLabel(m.channel)} · {new Date(m.created_at).toLocaleString()}
+                        {channelLabel(m.channel)} · {formatCommsDateTime(m.created_at, org?.booking_timezone ?? "America/Toronto")}
```

## Verify + ship (macOS)
1. `npx tsc --noEmit` (expect clean).
2. `npm run lint` (known unrelated <img> warning is fine).
3. `npm run build` (expect the usual page count).
4. `git add lib/tenant-comms.ts "app/dashboard/tenancies/[id]/page.tsx"` — ONLY these two files.
5. Commit: `fix(tenant-comms): show scheduled/sent message times in org timezone, not UTC`
6. Push to main. Vercel auto-deploys; confirm the new deploy READY and that the Scheduled-messages
   list on a tenancy now shows the operator's local time.

## Notes
- Scope is display-only; no migration, no schema, no logic change.
- The OTHER thing Cowork saw during dogfood (unchecking a recipient didn't stick) was an AUTOMATION
  artifact (form_input doesn't fire React onChange) — a real human click deselects fine. NOT a bug,
  do NOT "fix" it.
