# CODEX PROMPT — S577: idempotent portal-lead ingest via `leads.ingest_message_key`

Implement this end to end in `vacantless-app`, following every standing constraint
below. **Do not `git push`** — land the changes natively; Noam pushes.

## Why

The portal-lead ingest (`app/api/inbound/lead/route.ts`, the last link in the
syndication chain) currently dedupes by **content**: same org + same renter +
same normalized message + same unit inside a time window. The route itself flags
this as a stopgap (around line 347: *"No ingest_message_key column exists on
leads, and adding one is a migration."*). Content-based dedupe is brittle in both
directions — a provider **retry** of the identical email is caught only while it
stays inside `DEDUPE_WINDOW_MS`, and any downstream change to how notes are
composed can break the match.

A stable, hashed message-key already exists and is proven on the sibling ingests:
`ingestDedupeKey(provider, messageId, fallback)` in `lib/email-ingest.ts` (used by
`lib/etransfer-ingest.ts` and the asset ingest). This slice gives the **leads**
ingest the same idempotency: a durable per-org key derived from the provider
Message-ID, so a redelivery is a no-op regardless of window or content.

This is additive and correctness-only — no behaviour changes on first delivery.

## Scope

1. **Migration** `supabase/migrations/0190_leads_ingest_message_key.sql` (confirm
   the next free number at author time; 0189 is the latest on disk):
   - `alter table public.leads add column if not exists ingest_message_key text;`
   - A partial UNIQUE index scoped per org, ignoring nulls:
     `create unique index if not exists leads_org_ingest_message_key_uidx
      on public.leads (organization_id, ingest_message_key)
      where ingest_message_key is not null;`
   - The column stays null for every non-ingest lead (public `/r`, manual), so the
     partial index never constrains them.

2. **Route** `app/api/inbound/lead/route.ts`:
   - Compute `const messageKey = ingestDedupeKey("portal", messageId, fallback)`
     where `messageId` is the Postmark `Message-ID` already available to the route
     (use the same source the auth/loop layer reads; do not invent a new header
     read if one is already parsed). `fallback` = a stable basis when no
     message-id is present (e.g. `${orgId}:${lead.email ?? lead.phone ?? ""}:${adId ?? ""}`).
   - **Before** the content-based block: if `messageKey` is derivable, look up an
     existing lead for this org with that `ingest_message_key`; if found, return
     `{ ok: true, handled: "duplicate", lead_id }` exactly as today (same shape).
   - On **write**, stamp `ingest_message_key = messageKey`. The write goes through
     `submit_public_lead` when a property resolved and a direct insert otherwise —
     check the RPC's real signature: if `submit_public_lead` does not accept the
     key, stamp it with a follow-up `update ... where id = <new lead id>` rather
     than changing the RPC contract (least-invasive; keep the RPC's `leads.source`
     stamping intact — that indistinguishability from a `/r` lead matters).
   - Keep the existing content-based dedupe as the **fallback** path for the
     no-message-id case only. Do not delete it.
   - Handle the unique-violation race: if two deliveries land concurrently, the
     second insert hits the partial unique index — catch the conflict and return
     the `duplicate` shape rather than 500.

3. **Test** (tsx suite, matching the existing ingest test style): assert
   (a) a second POST with the same Message-ID is a no-op returning `duplicate` and
   writes no second row; (b) a first delivery with no Message-ID still writes and
   still honours the content-based fallback; (c) two different Message-IDs for the
   same renter/unit both get through (a real second inquiry is not lost).

## Standing constraints (from the session handoff)

- Land changes **natively** on the Mac; **do not `git push`** (bridge push = 403;
  Noam pushes).
- The migration **rides in the commit UNAPPLIED** — do not apply it to prod;
  Noam applies deliberately before it matters. The route must not assume the
  column exists at deploy time beyond a null-safe read (the `if not exists` +
  nullable column means an un-migrated prod simply never finds a key row; ensure
  a missing column can't 500 the route — gate the lookup/stamp so that if the
  column/index isn't there yet the route falls back to today's content dedupe).
- Reuse `ingestDedupeKey` verbatim — do not re-implement hashing.
- Verify the **real** signatures before wiring (KI926): `ingestDedupeKey`'s
  params, `submit_public_lead`'s params, and how the route currently obtains the
  Postmark Message-ID. Match them; do not code against an illustration.
- No secrets in code. tsc must stay clean; run the tsx suite natively (tsx does
  not run over the bridge).

## Definition of done

- New migration file present (unapplied).
- Route is idempotent on Message-ID, falls back to content dedupe without one,
  and cannot 500 on an un-migrated prod.
- New tests pass natively; `tsc` clean.
- Report back what changed + the exact file list for warm-verify.
