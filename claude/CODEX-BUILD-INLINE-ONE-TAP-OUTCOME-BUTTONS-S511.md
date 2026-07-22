# CODEX BUILD — Inline one-tap outcome buttons in the nudge email (S511)

**Anchor:** app HEAD `d3dd83a`, latest migration `0157`. Design:
`claude/DESIGN-INLINE-ONE-TAP-OUTCOME-BUTTONS-S511.md`.

**One-line:** Replace the single "Record the outcome" CTA in the post-showing outcome-nudge email with
an inline **outcome-button row**; each button opens a **minimal pre-scoped confirm page** that
**auto-submits a POST on load** (visible no-JS fallback), reusing the existing outcome RPCs. **No
migration. No new RPC.**

**Hard rule (do not break):** the outcome write stays a **POST server action**, never a GET side-effect
(KI585 — see the header comments in `app/agent/[token]/actions.ts` and `app/showing/[token]/actions.ts`).
The new `/record` pages only **render** on GET; the auto-submit is client JS. A link scanner that
prefetches the GET must mutate nothing.

---

## Files to change / add

### 1. Email builder — multi-button support (`lib/email.ts`)

`notificationHtml(p)` currently renders a single CTA from `p.action_url` / `p.action_label`
(around L2052–2067). Add an **optional** `actions` array to `NotificationEmailPayload` and render it as a
button row when present; keep the existing single-`action_url` path byte-for-byte unchanged for every
other event.

- Extend the payload type (near L2018):
  ```ts
  action_label?: string | null;
  action_url?: string | null;
  // NEW — when set, render a row of outcome buttons instead of the single CTA.
  actions?: Array<{ label: string; url: string; variant?: "primary" | "secondary" }> | null;
  ```
- In `notificationHtml`, if `p.actions?.length`, render a centered row of branded buttons **instead of**
  the single `action` block: `primary` = filled brand background + white text (reuse the existing single-CTA
  button styling); `secondary` = white background, `#d4d4d8` border, `#3f3f46` text. Follow with a
  plain-text fallback block listing each `label → url` (adapt the existing "If the button does not open…"
  block to loop over `p.actions`).
- Email-client safety: use inline styles + `<a>` tags only (no flexbox reliance — stack with
  `display:inline-block` + margins so it degrades in Outlook). `escapeHtml` every label and url exactly as
  the current code does.
- Thread the new field through `sendNotificationEmail` payload and `sendOrgNotification`
  (`lib/notifications-server.ts`): add an optional `actions` alongside the existing `action` in the
  `sendOrgNotification` args and pass it into `sendNotificationEmail(...)`. When `actions` is present,
  `action_label`/`action_url` may be omitted.

### 2. Cron — build per-outcome URLs + pass the button row (`app/api/cron/showing-outcome-nudge/route.ts`)

Today (L270–330) it computes one `outcomeUrl` (`/agent/{agent_token}` for the agent, else
`/showing/{outcome_token}`) and passes `action: { label: "Record the outcome", url }`.

Change to compute the **audience-specific outcome links** and pass them as `actions`:

- Agent branch (`toAgent === true`, base `/agent/{agent_token}`):
  ```
  Renter showed → `${base}/record?showing=${row.id}&o=attended`   (primary)
  No-show       → `${base}/record?showing=${row.id}&o=no_show`     (secondary)
  ```
- Operator branch (base `/showing/{outcome_token}`):
  ```
  Attended  → `${base}/record?o=attended`    (primary)
  No-show   → `${base}/record?o=no_show`      (secondary)
  Cancelled → `${base}/record?o=cancelled`    (secondary)
  ```
- Keep `vars.outcome_url` = the plain landing URL (no `/record`) so the **body template text still
  resolves** `{{outcome_url}}` and the "open the calendar" link keeps working. Pass the new `actions`
  array to `sendOrgNotification`; drop the single `action: { label: "Record the outcome", … }` for this
  event (the row replaces it).
- `?dry=1` output: add the `actions` array (labels + urls) to `summary.details` so QA can copy a
  `/record` URL without sending mail.
- URL-encode tokens/ids exactly as elsewhere.

### 3. Agent confirm route (NEW) — `app/agent/[token]/record/page.tsx`

Minimal server component. Reads `params.token`, `searchParams.showing`, `searchParams.o`.

- Validate `o ∈ {attended, no_show}`; if not, redirect to `/agent/{token}` (no auto-submit, no POST).
- Resolve the agent by `agent_token` (admin client, `archived=false`) exactly like the calendar page; on
  no agent → `notFound()`. Load the one showing by `showing`+`assigned_agent_id`+`organization_id`
  (name/address/time only — same PII scope as the calendar page: `lead(name)`, `property(address)`); if
  not found → render a friendly "couldn't find that viewing — open your calendar" card linking
  `/agent/{token}`.
- Render **one** card: heading "Mark this viewing as **{Renter showed|No-show}**?", the renter name +
  address + formatted time (reuse `fmtWhen`-style formatting and the org brand), and a
  `<form action={recordOutcomeFromToken}>` (the **existing** action in `app/agent/[token]/actions.ts`,
  unchanged) with hidden `token`, `showing_id`, `outcome`, and a single visible **Confirm** button.
- Mount `<AutoSubmit />` (component #5) bound to that form.
- If the showing is already closed (`outcome` not null/`scheduled`), skip auto-submit and render a
  "already recorded as X" card linking back to the calendar (the RPC would no-op anyway; this avoids a
  pointless POST).

### 4. Operator confirm route (NEW) — `app/showing/[token]/record/page.tsx`

Same shape, using the operator model:

- Validate `o ∈ {attended, no_show, cancelled}`; else redirect to `/showing/{token}`.
- Resolve the showing by `outcome_token` (admin client) for the display fields; on none → `notFound()`
  or the existing invalid path.
- Card + `<form action={recordOutcomeFromToken}>` (the **existing** action in
  `app/showing/[token]/actions.ts`, which takes `token` + `outcome`, no showing id) with hidden `token`,
  `outcome`, single Confirm button. Mount `<AutoSubmit />`.
- Already-recorded → the operator RPC is idempotent (0099), but still prefer the "already recorded" card
  (skip auto-submit) for a clean UX.

### 5. Auto-submit client component (NEW) — `app/agent/[token]/record/auto-submit.tsx` (or a shared `components/`):

```tsx
"use client";
import { useEffect, useRef } from "react";
export function AutoSubmit({ formId }: { formId: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;         // guard React strict-mode double-effect
    fired.current = true;
    const f = document.getElementById(formId) as HTMLFormElement | null;
    f?.requestSubmit();
  }, [formId]);
  return null;
}
```

- The confirm form gets `id={formId}` so the component can find and `requestSubmit()` it once.
- Rationale in a comment: real browsers auto-fire the POST (one-tap); link scanners don't run JS so they
  never submit (KI585 preserved); no-JS clients use the visible Confirm button.

---

## Explicitly NOT in scope
- **No migration.** Reuse `record_showing_outcome_from_agent_token` (0120: attended/no_show only,
  `too_early`/assigned/open-only guards, no-op double-tap) and `record_showing_outcome_from_token`
  (0098/0099: attended/no_show/cancelled, idempotent). Do not touch either RPC.
- No change to escalation (`outcomeNudgeStepDue`), the opt-in gate (`isDripEnqueueEnabled`), recipient
  resolution, or the body template text. `{{outcome_url}}` still resolves to the plain landing page.
- Do not add a GET mutation anywhere. Do not add `cancelled` to the agent route/RPC.

## Guardrails / edge cases (must handle)
1. Invalid/missing `o` → redirect to the plain landing page, never POST.
2. Wrong/garbage token or showing not assigned to the agent → the existing RPCs already return
   `not_found` and record nothing; the page should also fail closed (notFound / friendly card) before
   auto-submitting.
3. Double-fire (strict-mode, refresh, or scanner+human) → RPC no-op/idempotent; `AutoSubmit` latches with
   a ref; safe.
4. `too_early` (agent RPC) → only possible if triggered before the viewing; nudge fires after, so normal
   flow never hits it, but the RPC rejects it → confirm page shows the existing error banner.
5. Outlook/no-flexbox rendering → buttons must stack acceptably with inline-block, not collapse.

## Test plan
- `scripts/` unit test for the email builder: `notificationHtml` with `actions` renders N branded
  `<a>` buttons + the plain-text fallback list; with only `action_url` renders exactly the current single
  CTA (snapshot/parity — no regression for other events).
- Route tests (or a documented manual QA): agent `/record` with valid `o` renders the confirm card +
  hidden form with correct hidden inputs; invalid `o` redirects; operator `/record` all three outcomes.
- `?dry=1` on the cron returns per-outcome `/record` URLs for a real Agile showing (agent branch: 2 urls;
  operator branch: 3).
- `tsc` / `build` / `lint` clean.
- **Manual, on Noam's go:** open a `?dry=1`-sourced agent `/record?showing=…&o=no_show` URL in a browser →
  auto-submits → lands on the calendar with the "marked as a no-show" banner and the RPC recorded it;
  disable JS → the Confirm button records on one tap.

## Deploy / verify (Cowork)
1. Verify the diff in MAIN via `device_bash git` (expect: `lib/email.ts`, `lib/notifications-server.ts`,
   `app/api/cron/showing-outcome-nudge/route.ts`, two new `record/page.tsx`, one `auto-submit.tsx`, one
   test file; **no** `supabase/migrations/*`).
2. Re-run the email-builder unit test in the **cloud** container (device VM can't run tsx —
   esbuild macOS-binary-in-Linux mismatch).
3. Noam pushes (clear `.git/index.lock` + `.git/HEAD.lock` first); confirm Vercel READY.
4. Browser-QA the confirm routes with a `?dry=1` URL. **Hold the visible email go-live for Noam's go.**
