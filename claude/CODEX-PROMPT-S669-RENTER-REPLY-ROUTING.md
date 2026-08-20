# CODEX PROMPT - S669, renter replies stop dying in leads@vacantless.com

_Strategy and the why: `claude/STRATEGY-RENTER-REPLY-ROUTING-S668.md` in the MAIN CLONE at
`~/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app/claude/`. Read it first.
Do not copy it into the worktree and do not commit it on this branch._

## The problem in one paragraph

Every renter-facing email Vacantless sends shows `leads@vacantless.com` as the From address, with
the customer's identity carried only in the display name and `Reply-To`. That is deliberate
(`lib/email.ts:20-23`) and the Reply-To is correct: verified from raw headers on 2026-07-15 and
2026-08-19, Agile's renter mail carries `Reply-To: "Agile Real Estate Group"
<rentals@agileonline.ca>`. But Reply-To is a request, not routing. On 2026-08-19 a renter replied to
the From address instead, and her message, asking for a viewing, landed in a shared Vacantless
mailbox that no customer watches. Nothing in the product noticed. That failure scales with the
customer count and it is silent.

## Working agreement

- Worktrees on branch `codex/s669-renter-reply-routing`, created by
  `WORKTREE-S669-REPLY-ROUTING.sh`. App repo only; the worker is not involved.
- Never `git add -A`. The app repo is PUBLIC. Explicit paths only.
- Commit and push to the branch. Do not merge to `main`, do not deploy.
- **Ship it dark.** Everything in Slice A sits behind an env flag that is OFF by default.

## Reuse, do not reinvent

The addressing model and the entire inbound trust boundary already exist and are unit-tested:

- `lib/email-ingest.ts`: `INGEST_LOCALPART_PREFIX` (`u-`), `DEFAULT_INGEST_DOMAIN`
  (`in.vacantless.com`, overridden by `INGEST_EMAIL_DOMAIN`), `verifyIngestSecret`,
  `readIngestSecretFromAuth`, `isAllowedSenderEmail`, `isAutoReplyOrLoop`, `ingestDedupeKey`.
- `app/api/inbound/lead/route.ts` (8 lines) delegating to `lib/portal-lead-ingest-server.ts`. Copy
  that route/lib split exactly.
- `organizations.slug` exists but is NOT suitable as a mail alias (see Slice A1).

**Verified infrastructure facts (checked 2026-08-19, do not re-derive):**

- `in.vacantless.com` MX is `10 inbound.postmarkapp.com` [verified via DNS over HTTPS]. **Inbound is
  POSTMARK**, so the webhook payload is Postmark's inbound JSON, exactly what the siblings already
  parse: recipients from `["To", "Cc", "OriginalRecipient"]`
  (`lib/portal-lead-ingest-server.ts:326`, `app/api/inbound/asset/route.ts:164`), sender from
  `payload.FromFull.Email` with a `From` fallback, body from `TextBody` / `StrippedTextReply` /
  `HtmlBody` (`portal-lead-ingest-server.ts:439-440`). **Prefer `StrippedTextReply`** for a renter
  reply: Postmark has already removed the quoted history, which is exactly what the operator wants
  to read.
- `parseIngestToken` (`lib/email-ingest.ts`) hard-requires the `u-` prefix and a 24-64 char token,
  so a slug address returns null from it today. Add a SIBLING pure function
  `parseIngestAlias(recipient, ingestDomain)` next to it, unit-tested in the same style. **Do not
  loosen `parseIngestToken`** - the asset and portal-lead routes depend on its strictness.
- `submit_public_lead` does **not** currently return the slug. Verified by reading the deployed
  function: its closing `jsonb_build_object` returns `lead_id, lead_reused, lead_has_showing,
  org_id, renter_name, renter_email, org_name, brand_color, logo_url, reply_to_email,
  property_address, rent_cents, template_subject, template_body`. Add `'mail_alias', v_alias` beside
  `'reply_to_email', v_reply_to` in your migration, selecting `o.mail_alias` into a new `v_alias` where
  the function already selects `o.name, o.brand_color, o.logo_url, o.reply_to_email`.
- Relay recipients: reuse `sendOrgNotification` (`lib/notifications-server.ts:87`), which already
  reads `notification_settings` at `:98`. Do not re-implement recipient resolution.
- There is **no existing rate-limit helper** in `lib/` (grep for `rateLimit` / `rate.?limit` returns
  nothing), so write a small one rather than hunting for it.

## Slice A - a real per-org From address (dark by default)

**Read the DNS table in the strategy doc before starting.** The short version, all verified
2026-08-19: `vacantless.com` is Brevo-authenticated (DKIM `s=brevo2`, `brevo-code` TXT) and its MX is
ImprovMX forwarding, while `in.vacantless.com` has a Postmark MX but **no SPF and no Brevo DKIM**.
So renter mail must go out from the MAIN domain, not the ingest subdomain.

### A1. Migration: an explicit per-org mail alias

Add `organizations.mail_alias text` (nullable, no default) plus a partial unique index on
`lower(mail_alias)` where it is not null, and a check constraint `mail_alias ~ '^[a-z0-9][a-z0-9-]{1,30}$'`.

**Do NOT derive the alias from `slug`.** The live slugs are machine strings
(`agile-real-estate-group-i0jn`), one contains a fragment of a person's email address, and a slug
rename would silently break a live mail alias. This is an explicit, admin-set value.

### A2. `senderOf` in `lib/email.ts`, beside `replyToOf`

```
function senderOf(mailAlias: string | null | undefined, orgName: string | null)
```

- When `process.env.RENTER_FROM_ORG_ALIAS === "1"` AND `mailAlias` matches
  `^[a-z0-9][a-z0-9-]{1,30}$`, return
  `{ name: orgName || "Vacantless", email: `${mailAlias}@vacantless.com` }`.
- Otherwise return today's `{ name: orgName || "Vacantless", email: DEFAULT_SENDER_EMAIL }`.
- Reject the reserved words `leads`, `admin`, `info`, `support`, `noreply`, `no-reply`, `postmaster`,
  `abuse` and anything starting `u-`, falling back to the default. An alias that shadows an existing
  ImprovMX alias would divert real mail.

Apply it ONLY to renter-facing senders (`sendAutoReply`, `sendBookingConfirmation`,
`sendShowingReminder`, `sendShowingRescheduled`, `sendRescheduleProposal`,
`sendRescheduleAcceptedConfirmation`, `sendShowingAutoReleased`, `sendFeedbackRequest`,
`sendPriceDropAlert`, `sendWaitlistVacancyAlert`, `sendViewingTimesOpenedEmail`,
`sendNurtureEmail`, `sendRentalApplicationInvite`). **Operator notifications keep
`leads@vacantless.com`** - do not touch `sendOrgNotification` / `lib/notify-new-lead-server.ts`.

`Reply-To` is unchanged everywhere. Do not touch `replyToOf`.

### A3. Thread `mail_alias` through the payloads

Same pattern `reply_to_email` already uses: add it to every org `.select(...)` found by
`grep -rn "reply_to_email" app lib --include=*.ts | grep select`, and add `'mail_alias', v_alias`
to `submit_public_lead`'s returned json (see the verified note above for its exact current keys).

### A4. Settings UI

Expose the alias on the org settings surface as a plain text field with the address previewed in
full (`agile@vacantless.com`), and copy stating that the alias must also exist as an ImprovMX
forward before it is used. Validation mirrors the check constraint.

**Do not enable the flag anywhere, and say so in your report.** Sending from an alias whose ImprovMX
forward does not exist yet would bounce every renter reply instead of routing it. Alias creation is
Noam's step and happens outside the app.

## Slice B - `app/api/inbound/reply`

**How mail actually reaches this route, since it is not obvious and getting it wrong means building
a route nothing ever hits.** Renter mail goes out From `agile@vacantless.com`, whose MX is ImprovMX,
so a reply lands at ImprovMX, NOT at Postmark. The ImprovMX alias therefore forwards to **two**
destinations: the customer's own inbox (so they get it immediately, even if this route is broken or
off) and `agile@in.vacantless.com`, the Postmark ingest address that feeds this webhook. Postmark
then POSTs it here.

Consequence for step 2: the recipient the payload carries may be on EITHER domain, because ImprovMX
preserves the original `To` while the envelope recipient becomes the ingest address. Accept a
local-part match on `INGEST_EMAIL_DOMAIN` **or** on `vacantless.com`, and check every candidate in
`["To", "Cc", "OriginalRecipient"]` the way the siblings already do.


New route `app/api/inbound/reply/route.ts` (thin, like `inbound/lead`) delegating to
`lib/renter-reply-ingest-server.ts`. Layers, fail-closed, in this order:

1. `verifyIngestSecret` / `readIngestSecretFromAuth` against `INBOUND_WEBHOOK_SECRET`. Same as
   siblings.
2. Resolve the recipient local-part to an org **by `mail_alias`**, case-insensitively, on
   `INGEST_EMAIL_DOMAIN` (`in.vacantless.com`, the Postmark side). A `u-` prefixed address is NOT
   ours: return the same not-found shape the siblings use rather than guessing.
3. `isAutoReplyOrLoop` drop. Also drop anything whose From is `@vacantless.com` or
   `@in.vacantless.com`: our own auto-reply must never feed itself.
4. `ingestDedupeKey` idempotency, same as siblings.
5. Resolve the lead: the most recent non-archived lead in that org whose email equals the sender's,
   case-insensitive. **No match is a legitimate state, not an error** - carry on to step 6 with a
   null lead and say so in the relay.

**The per-org verified-sender allow-list must NOT be applied here.** A renter is by definition not a
verified sender. That is exactly why this route may never write anything authoritative. Say this in
a comment so the next reader does not "fix" the missing allow-list.

Then act:

6. Relay to that org's `leasing.new_lead` recipients (read `notification_settings`, same resolution
   the new-lead alert uses), with **`Reply-To` set to the renter's address**, a subject like
   `Renter reply - <property address or "unmatched">`, and the message body. Include a line naming
   the lead and its dashboard URL when matched, and a plain "we could not match this reply to a
   lead" line when not.
7. Append a note to the matched lead and bump its last-contact state so the nudge automations stop
   treating it as untouched.

**PII posture, deliberate and narrow.** `lib/email-ingest.ts` says never persist raw email bodies or
headers. Keep that: **relay the body by email, persist only metadata** (sender, timestamp, relay
recipients, matched/unmatched). Do not write the body into the lead timeline. Storing the
conversation is a separate product decision and is NOT in this slice.

Rate-limit: at most 10 relays per org per hour and 3 per lead per hour, dropped with an audit line
beyond that. An inbound loop that gets past step 3 must not be able to mail a customer 400 times.

## Slice C - name the address in the copy

`defaultHtml` in `lib/email.ts` says "feel free to reply to this email". When the org has a
`reply_to_email`, add ", or write to us directly at <that address>". One sentence. It gives every
renter a working path even when their client ignores Reply-To, and it costs nothing.

## Out of scope

- Per-customer authenticated sending domains (`From: rentals@agileonline.ca`). Needs customer DNS;
  separate slice, separate onboarding flow.
- Storing renter reply bodies in the lead timeline.
- Any change to operator alert routing or recipients. `leasing.new_lead` for Agile already lists
  `rentals@agileonline.ca`, `peterszummer@gmail.com` and `noam@royallepage.ca`; that is correct.
- Touching `Reply-To` anywhere.

## Tests

1. `senderOf`: flag off returns `leads@vacantless.com`; flag on with alias `agile` returns
   `agile@vacantless.com`; a reserved alias (`leads`, `admin`, ...), an alias starting `u-`, an
   empty alias and one with uppercase or a dot all fall back to the default.
2. Route: bad secret rejected; `u-<token>@` address not claimed; auto-reply/loop dropped; duplicate
   delivery deduped; unmatched sender still relays; rate limit trips.
3. A regression test asserting operator notifications still send from `leads@vacantless.com` with
   the flag ON.
4. `tsc --noEmit`, lint, build.

## Definition of done

Branch pushed, flag still off, and a report stating the migration number used, which tests you
EXECUTED versus reasoned about, and an explicit line confirming you did not enable
`RENTER_FROM_ORG_ALIAS` anywhere.

---

## ANCHOR RE-DERIVATION AT THE BUILD SHA (added S669, standing rule 100)

Every anchor below was re-read from `main` at **`0ff62d1`** ("S668b: harden spend authorization
migration", 2026-08-20), which is the exact sha `WORKTREE-S669-REPLY-ROUTING.sh` cuts the worktree
from. **All anchors above are CORRECT at that sha.** Do not re-derive them; do correct for the
three items in the next section.

| Anchor as cited | Confirmed at `0ff62d1` |
|---|---|
| `lib/email.ts:20-23` | Comment at 20-22, `DEFAULT_SENDER_EMAIL` at 23. Exact. |
| `lib/portal-lead-ingest-server.ts:326` | `for (const key of ["To", "Cc", "OriginalRecipient"])`. Exact. |
| `lib/portal-lead-ingest-server.ts:439-440` | 439 `htmlBody`, 440 `textBody`. Exact. See correction 1. |
| `app/api/inbound/asset/route.ts:164` | Same recipient loop. Exact. |
| `lib/notifications-server.ts:87` | `export async function sendOrgNotification(`. Exact. |
| `lib/notifications-server.ts:98` | `.from("notification_settings")`. Exact. |
| `app/api/inbound/lead/route.ts` "8 lines" | Exactly 8 lines. |
| `lib/email-ingest.ts` named exports | All present: `INGEST_LOCALPART_PREFIX`:44, `DEFAULT_INGEST_DOMAIN`:48, `parseIngestToken`:100, `isAllowedSenderEmail`:187, `isAutoReplyOrLoop`:411, `verifyIngestSecret`:435, `readIngestSecretFromAuth`:454, `ingestDedupeKey`:479. |
| `parseIngestToken` strictness | Confirmed at 100-114: hard-requires the `u-` prefix and `^[a-z0-9]{24,64}$`. A slug address returns null. |
| The 13 renter-facing senders | All 13 exist in `lib/email.ts`. None missing, none renamed. |
| `replyToOf` | `lib/email.ts:34`. Leave it alone as instructed. |
| `organizations.slug` exists, `mail_alias` does not | Confirmed live via Supabase `information_schema`: `slug` text NOT NULL present, **`mail_alias` absent**. |
| `submit_public_lead` returned keys | Confirmed live: **one overload**, returns exactly the 14 keys listed above, in that order, and contains no `mail_alias`. |
| The `o.name, o.brand_color, o.logo_url, o.reply_to_email` select site | Confirmed: those four appear on one contiguous line of a `select ... into`. Add `o.mail_alias` there. |

### Correction 1 (IMPORTANT, the prompt contradicts itself)

The prompt says both "Copy that route/lib split exactly" and "**Prefer `StrippedTextReply`**". The
sibling at `portal-lead-ingest-server.ts:440` actually reads:

```
textBody: str(payload.TextBody) || str(payload.StrippedTextReply) || null,
```

so in the sibling **`TextBody` WINS**, which is the opposite of the stated preference. Copying it
exactly would defeat the instruction. For the renter-reply route, deliberately **invert it**:

```
str(payload.StrippedTextReply) || str(payload.TextBody) || null
```

Reason: Postmark has already removed the quoted history from `StrippedTextReply`. Taking `TextBody`
first would relay the renter's entire quoted thread back to the operator on every reply. Copy the
route/lib SPLIT exactly; do not copy this one line.

### Correction 2 (A3 scope is a known number, do not guess it)

`grep -rn "reply_to_email" app lib --include=*.ts | grep select` returns **14 sites** at `0ff62d1`.
Treat 14 as the completeness target. The `--include=*.ts` restriction is safe: the same grep over
`*.tsx` returns **zero** select sites, so nothing is hidden by it. (58 files mention
`reply_to_email` in total; most are not selects. Do not widen to all 58.)

### Correction 3 (minor, the claim is stronger than stated)

"No existing rate-limit helper in `lib/`" is true and also true of `app/`: a case-insensitive
`rate.?limit` search across both trees returns nothing at `0ff62d1`. Write your own.

### Still true and still blocking the FLIP, not the BUILD

The ImprovMX alias `agile@vacantless.com` forwarding to BOTH `rentals@agileonline.ca` AND
`agile@in.vacantless.com` **does not exist yet** [confirmed with Noam 2026-08-20]. Ship dark as
instructed. **Do not set `RENTER_FROM_ORG_ALIAS` anywhere**, and state in your report that you did
not.
