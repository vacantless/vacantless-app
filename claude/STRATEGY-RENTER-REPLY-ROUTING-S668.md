# STRATEGY - where renter replies should land (S668, 2026-08-19)

_Trigger: Jade Chaloux replied to the 1551 Assumption D auto-reply and her reply arrived at
`leads@vacantless.com` instead of Agile. She wants a viewing and cannot use her phone, so this one
was nearly a lost lease, not a nuisance._

## First, what is NOT broken

**Reply-To is correct and always has been.** Verified from RAW headers, not from code reading:

- Auto-reply to a renter, 2026-07-15, Agile property [Gmail msg `19f6667712375474`]:
  `From: "Agile Real Estate Group" <leads@vacantless.com>` and
  `Reply-To: "Agile Real Estate Group" <rentals@agileonline.ca>`.
- Operator alert, 2026-08-19, Jade's lead [Gmail msg `1a01c7e031a6a806`]: same pair.

Agile's `organizations.reply_to_email` is `rentals@agileonline.ca`, `submit_public_lead` returns it,
`replyToOf` (`lib/email.ts:34`) applies it, and Brevo honours it. **Do not "fix" the Reply-To.**

**The new-lead alerts are also routed correctly.** `notification_settings` for
`leasing.new_lead` lists `rentals@agileonline.ca`, `peterszummer@gmail.com`, `noam@royallepage.ca`.
Aaliyah gets her own copy; Noam's is one of three, not a misroute.

## So what actually happened

The renter replied to the **From** address, not the Reply-To. Mail clients are free to do that, and
some do. Reply-To is a request, not a routing guarantee.

That is not a defect in one email. It is a property of the architecture, stated in
`lib/email.ts:20-23`: every org's mail goes out under one shared authenticated sender, with the
customer's identity carried only in the display name and Reply-To. **The visible address on every
renter-facing email Vacantless has ever sent is `leads@vacantless.com`.** Any renter whose client
ignores Reply-To, or who copies the address out of the header, or who writes to it later from
scratch, reaches a mailbox that belongs to no customer and that nobody watches on their behalf.

**The exposure scales with the customer count and it fails silently.** The renter thinks they have
replied to the landlord. The landlord never learns the renter existed. Nothing in the product
notices. That is the worst failure shape a leasing funnel can have.

## The strategy

Three phases, cheapest first, each shippable alone.

### Phase 0 (today, no code) - stop the bleeding

Put a human watch on `leads@vacantless.com`. Anything that is not a bounce or a Brevo notice is a
renter and belongs to some customer. Until Phase 2 exists, that mailbox is a lead source, not an
outbox.

### Phase 1 (cheap, and cheaper than either earlier draft) - a real per-org From address

**This section has been rewritten twice. Both earlier drafts were more expensive than reality,
because they were written before checking DNS. What the DNS actually says [all verified 2026-08-19
via DNS-over-HTTPS]:**

| Name | Record | Meaning |
|---|---|---|
| `vacantless.com` MX | `10 mx1.improvmx.com`, `20 mx2.improvmx.com` | **Inbound mail for the main domain is ImprovMX forwarding.** `leads@vacantless.com` is an alias, not a mailbox. That is how Jade's reply reached a personal Gmail. |
| `vacantless.com` TXT | `v=spf1 include:spf.improvmx.com ~all`, `brevo-code:4f1a71c5…` | Brevo-verified. Brevo mail passes DMARC by **DKIM alignment** (`d=vacantless.com s=brevo2`, seen in real headers), not by SPF. |
| `in.vacantless.com` MX | `10 inbound.postmarkapp.com` | The ingest subdomain receives via **Postmark**. |
| `in.vacantless.com` TXT | none | **No SPF.** |
| `brevo1/brevo2._domainkey.in.vacantless.com` | NXDOMAIN | **No Brevo DKIM.** Sending from this subdomain today would be unauthenticated. |
| `_dmarc.vacantless.com` | `v=DMARC1; p=none; rua=…@dmarc.brevo.com` | No `sp=`, policy is monitor-only. |

So the cheap move is not the ingest subdomain at all. It is the main domain, which is already
Brevo-authenticated and already has ImprovMX forwarding in front of it:

1. Give each customer org an explicit short mail alias, e.g. `agile`, stored in a new nullable
   `organizations.mail_alias` column. **Do not derive it from `slug`** - the slugs are machine
   strings like `agile-real-estate-group-i0jn`, one of them contains a fragment of somebody's email
   address, and a slug rename would silently break a live alias.
2. Create the matching ImprovMX alias `agile@vacantless.com` forwarding to the org's
   `reply_to_email`, **and** to a Vacantless archive address, so a reply reaches the customer
   immediately without Vacantless going blind to it.
3. Send renter-facing mail as `"Agile Real Estate Group" <agile@vacantless.com>`, Reply-To
   unchanged.

**Cost: one nullable column, one `senderOf` helper, and one alias per customer. Zero DNS changes,
zero Brevo domain work**, because `vacantless.com` is already authenticated and any address on it
can send with DKIM alignment intact. Renters see a human address instead of `leads@`, and a reply to
either the From or the Reply-To now reaches the customer.

Limits worth knowing before committing: ImprovMX plans cap alias counts, aliases are provisioned
outside the app (their API can automate it later), and this routes mail around the product rather
than through it, which is exactly what Phase 2 fixes.

### Phase 2 (the real answer) - ingest the reply into the lead

Add `app/api/inbound/reply` as a SIBLING of `inbound/lead`, reusing every security layer verbatim:

The two phases join at the ImprovMX alias: it forwards to the customer AND to
`<alias>@in.vacantless.com`, the Postmark ingest address. The customer keeps getting mail even if
this route is off or broken, and Vacantless gets a copy to file. That is deliberate - the routing
fix must not depend on the ingest working.


1. Resolve the org from the recipient slug, then the lead by matching the sender against that org's
   recent leads. No match is a legitimate state, not an error.
2. Relay the message to that org's `leasing.new_lead` recipients with **Reply-To set to the
   renter**, so the operator's reply reaches the person instead of the robot.
3. Append a note to the lead and bump its last-contact state so the nudge automations stop treating
   it as untouched.

**One deliberate tension to settle before building.** The ingress module's standing PII posture is
"never persist raw email bodies or headers". A renter reply is the one case where the body IS the
value. The safe default, and what the build prompt specifies, is: relay the body by email, persist
only a metadata note (who replied, when, where it was relayed). Storing the conversation in the lead
timeline is a bigger product decision and needs Noam's explicit sign-off, not a quiet exception.

### Phase 3 (optional, per customer) - their domain, their From

For customers who can edit DNS, authenticate their domain in Brevo and send genuinely as
`rentals@agileonline.ca`. Best possible renter experience and the misroute disappears entirely.

**This can never be the default.** Sending as a domain you have not authenticated fails DMARC the
moment that customer publishes `p=reject`, and most small landlords cannot or will not add DNS
records during onboarding. Offer it; do not depend on it.

## One copy change worth making immediately

The auto-reply says "feel free to reply to this email". Name the address too: "or write to us
directly at rentals@agileonline.ca". One line, no infrastructure, and it gives every renter a
working path even when their mail client ignores Reply-To. It also makes the misroute visible to
the renter rather than silent.

## Recommendation

Phase 0 now, Phase 1 next slice, Phase 2 as the funded piece of work, Phase 3 as an onboarding
option for customers with a domain. Do not start with Phase 3 and do not spend anything on
re-checking Reply-To.
