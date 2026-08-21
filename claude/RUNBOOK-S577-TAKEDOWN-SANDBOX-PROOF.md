# RUNBOOK — S577 take-down-on-lease-up SANDBOX PROOF (Growth Test)

Goal: turn the lease-up take-down link from **built + warm-verified + dark** into
**proven-live**, by having the worker do a **real Facebook Graph DELETE + GET-gone
confirm + `markTakenDown`** against a genuinely live FB post. That external Graph
behaviour is the one thing a crafted test cannot prove (rule 23); the decision
ladder itself is already unit-proven 10/10 natively.

After this, take-down joins publish (S552/S573) as a live-proven link; S552 stops
being the sole baseline for this feature.

- Org: **Growth Test `8ea1da48-0cd2-45a4-bfba-023b31a67884`** (confirm this equals
  the worker `.env` `TARGET_ORG_ID` VALUE before running anything — rule 24).
- Property used: **50 Glenrose Ave Unit 4 `edcd730e-aa83-4792-8ed9-c2090e58ac34`**.
- Substrate today (read 2026-07-26): facebook_feed account = `connected`,
  `automation_authorized=false`; a Page session row exists; 1 stale facebook_feed
  `live` listing_post `fe8557fc` but **0** `verified_live` verifications carrying a
  Graph post id — so nothing is take-down-able until a fresh post gives us a
  `verified_live` row. That is why the proof re-publishes first.

Grounded in the real code (read this session): `lib/leaseup-takedown.ts`,
`lib/leaseup-decision.ts`, worker `src/takedown-leaseup.ts`, `src/takedown-sweep.ts`,
`src/facebook-graph.ts`, migrations `0187`/`0188`.

Everything below that writes prod DB or flips a flag is **Noam's hands** — Cowork
seeds/verifies via read/least-privilege only on your explicit go.

---

## Why publish-then-take-down (not reuse the stale row)

The worker derives the Graph post id from a `distribution_verifications` row
(`result='verified_live'`, `metadata.external_listing_id`) — NOT from
`listing_posts.url`. The stale `fe8557fc` post has no such verification, and we
can't be sure its FB post still renders. Publishing one fresh post gives a
deterministic live target **and** its `verified_live` verification in one step,
and taking it back down demonstrates the full publish → take-down lifecycle end
to end. One clean live post, created and removed inside the proof.

---

## STEP 0 — apply the two migrations (Noam, deliberate)

Only `0187` + `0188` are needed for take-down (`0189` is the rent-ledger, unrelated).

- `0187_leaseup_takedown_removed_result_and_public_siblings` — adds `'removed'`
  to the `distribution_verifications.result` CHECK + the anon siblings RPC.
- `0188_distribution_run_items_takedown_transport` — adds `'takedown'` to the
  `distribution_run_items.transport` CHECK (strict superset of 0141).

Apply each (Supabase, your method). Without `0187`, `markTakenDown`'s
`result='removed'` insert is rejected by the CHECK and the item routes to
operator instead of confirming removed.

## STEP 1 — worker `.env` gates (Noam)

Confirm / set in the worker `.env` (the VALUE of TARGET_ORG_ID, not just presence — rule 24):

```
TARGET_ORG_ID=8ea1da48-0cd2-45a4-bfba-023b31a67884   # == Growth Test, verify VALUE
WORKER_ENABLED=true
LEASEUP_TAKEDOWN_ENABLED=true
FB_PAGE_CHANNEL_ENABLED=true
FB_GRAPH_VERSION=v21.0        # already set
SESSION_ENC_KEY=<already set, byte-identical to Vercel>
```

## STEP 2 — confirm the FB Page is still connectable (Noam)

The session row is from the s573 era. Open the Distribute tab for Growth Test and
confirm the Page still shows connected (or reconnect a Page you admin). If the
s573 test Page was deleted, connect a fresh personally-owned Page first — the
publish in Step 4 needs a live Page token.

---

## STEP 3 — arm the channel for the supervised proof (Noam's go; Cowork writes on go)

Publishing AND deleting both gate on `automation_authorized=true` + `account_status='connected'`.
Set it for the proof, revert at the end (same supervised pattern as s573):

```sql
update distribution_channel_accounts
set automation_authorized = true, updated_at = now()
where organization_id = '8ea1da48-0cd2-45a4-bfba-023b31a67884'
  and channel = 'facebook_feed';
```

## STEP 4 — publish one fresh FB post (establishes the live target)

Cowork seeds an operator-approved `facebook_feed` run item for 50 Glenrose Unit 4
(prod write, on your go), then you run:

```
WORKER_ENABLED=true FB_PAGE_CHANNEL_ENABLED=true \
TARGET_ORG_ID=8ea1da48-0cd2-45a4-bfba-023b31a67884 \
npm run submit:fb:dark        # dry: composes, no post
# then, live:
WORKER_ENABLED=true FB_PAGE_CHANNEL_ENABLED=true \
TARGET_ORG_ID=8ea1da48-0cd2-45a4-bfba-023b31a67884 \
npm run submit:fb:live
```

Expected: a real Graph post id, a `listing_posts` row `status='live'`, and a
`distribution_verifications` row `result='verified_live'` whose
`metadata.external_listing_id` is that Graph id. (This re-proves the publish link;
already green s573.)

Cowork then confirms the `verified_live` row + external_listing_id are present
before we enqueue the take-down.

## STEP 5 — enqueue the take-down item

Two ways; **5A (direct seed) is recommended** — it proves the real gap (the worker
delete) without a prod-wide app activation.

### 5A — direct seed (recommended, contained)

Cowork inserts one take-down run item against the property's active run, matching
exactly what `handleLeaseupAdLifecycle`'s automated branch writes (mode=concierge,
transport=takedown, publish_status=queued, channel=facebook_feed,
listing_post_id=<the fresh live post>). Cowork drafts the exact INSERT from the
live ids after Step 4 and runs it on your go.

### 5B — app leased-transition (optional, also exercises the app enqueue live)

Flip `LEASEUP_TAKEDOWN_ENABLED=true` on **Vercel** (app env) + redeploy, then mark
50 Glenrose Unit 4 **leased** in the app. `handleLeaseupAdLifecycle` runs the
ladder: with the only available sibling being this same unit (now leased) and
waitlist off on the `free` plan, the decision is `takedown`, and because
facebook_feed is authorized+connected it enqueues the automated `queued` item.

CAVEAT (5B): `LEASEUP_TAKEDOWN_ENABLED` is a **global app flag**, not per-org.
Flipping it on prod arms the ladder for every org. Automated delete still can't
fire for anyone else (no other org has facebook_feed authorized+connected), but a
real org that marks a property leased while it has a live listing_post would get
an **operator take-down task + a `leasing.distribution_takedown_needed`
notification**. Only choose 5B with that awareness; unset the flag after. 5A
avoids this entirely.

## STEP 6 — DRY preview the sweep (no delete)

With the item queued but one gate deliberately off, the sweep prints a
`would_delete` plan and deletes nothing (`runSweep` dry path). Preview first:

```
# temporarily leave LEASEUP_TAKEDOWN_ENABLED unset for this one call:
WORKER_ENABLED=true FB_PAGE_CHANNEL_ENABLED=true \
TARGET_ORG_ID=8ea1da48-0cd2-45a4-bfba-023b31a67884 \
npm run takedown:leaseup:sweep
```

Expected JSON: `dry_run: true`, `skippedReason` includes `leaseup_takedown_disabled`,
and `would_delete: [{ item_id, run_id, listing_post_id, page_id, external_listing_id }]`
listing your seeded item with the real Graph id. This proves selection against the
real DB with zero side effects.

## STEP 7 — EXECUTE the take-down (real Graph DELETE)

All gates on now:

```
WORKER_ENABLED=true LEASEUP_TAKEDOWN_ENABLED=true FB_PAGE_CHANNEL_ENABLED=true \
TARGET_ORG_ID=8ea1da48-0cd2-45a4-bfba-023b31a67884 \
npm run takedown:leaseup:sweep
```

The sweep claims the item (queued-only CAS), calls `deletePageFeedPost` →
`postReturns404` (accepts a raw 404 or Graph `code=100`/`subcode=33`/"does not
exist" — the S575b fix) → `markTakenDown`.

Expected JSON: `ok:true`, `processed:1`, `results[0].outcome:"removed"`,
`marked_removed:true`, a `verification_id`, `run_completed` per run state.

To also prove the **single-item** command (S575's original path) instead of / in
addition to the sweep, seed a second item and run:
`TAKEDOWN_ITEM_ID=<id> npm run takedown:leaseup`.

## STEP 8 — VERIFY (rule 16 — the object's own status row)

Cowork runs these reads (fill `<item_id>` / `<listing_post_id>` from the run):

```sql
-- the run item's own outcome
select id, publish_status, status, transport, mode, concierge_claimed_by, audit_message
from distribution_run_items where id = '<item_id>';

-- the removal proof row
select result, external_url, metadata->>'source' as source, checked_at
from distribution_verifications
where listing_post_id = '<listing_post_id>' and channel='facebook_feed'
order by checked_at desc limit 3;   -- expect a result='removed' row

-- the listing_post itself
select id, portal, status from listing_posts where id = '<listing_post_id>';  -- expect status='removed'
```

Then the external check (rule 23): the real FB post URL now 404s / no longer
renders on the Page. Attribution preserved: the `listing_posts` row + id survive
(status flipped, not deleted), so any tracked link keeps resolving.

## STEP 9 — CLEANUP

- Revert `automation_authorized=false` for Growth Test facebook_feed.
- If you used 5B, unset `LEASEUP_TAKEDOWN_ENABLED` on Vercel + redeploy (worker
  `.env` flag can stay; only the sandbox org is armed).
- Migrations 0187/0188 stay applied (additive, safe).
- Delete any leftover test Page/post whenever you like.

---

## PASS CRITERIA

1. STEP 6 `would_delete` lists the seeded item with the real Graph id (selection proven).
2. STEP 7 returns `outcome:"removed"` + `marked_removed:true`.
3. STEP 8: item not `queued`, a `result='removed'` verification exists,
   `listing_posts.status='removed'`, and the FB post is gone on the Page.

All three → the take-down link is **proven-live**. Update memory + NEXT-SESSION to
move it out of "dark, not proven-live."
