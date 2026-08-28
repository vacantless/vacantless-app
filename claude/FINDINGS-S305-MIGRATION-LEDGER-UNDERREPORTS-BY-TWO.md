# FINDINGS S305: the migration ledger says 0220, the database is actually at 0222

Written 2026-08-28 (S305). [verified 2026-08-28 via Supabase and git show at `b3b9b97`]

## The finding

`supabase_migrations.schema_migrations` ends at `20260821114744`, which is
`0220_renter_reply_ingests_revoke_truncate`. That is what `list_migrations` reports and
it is where every doc and memory line saying "the DB is at 0220" comes from.

Two further migrations exist on `origin/main` and **both are already applied in the
database while being absent from the ledger**:

- `0221_org_mail_alias_provisions.sql` — `to_regclass('public.org_mail_alias_provisions')`
  is not null, so the table exists.
- `0222_commercial_distribution_channels.sql` — all three widened check constraints
  already list `spacelist` and `costar_loopnet`, on `listing_posts.portal`,
  `distribution_run_items.channel` and `distribution_channel_accounts.channel`.

So the effective schema is 0222. The ledger under-reports by two.

## Why it matters

1. **Every "the DB is at NNNN" claim in the docs and in memory is derived from the ledger,
   not from the schema.** Project memory currently says 0221, the Agile
   `00-NEXT-SESSION.md` says 0220, and the database says 0222. Three numbers, none of them
   read from the objects themselves.
2. It inverts the usual failure. The standing worry has been code shipping ahead of
   schema. Here the schema shipped ahead of the ledger, which is the safer direction but
   is invisible to any tool that trusts `list_migrations`.
3. `0222`'s own header says "Apply in a separate DB gate before deploying UI that allows
   persisted SpaceList or CoStar/LoopNet run items." That gate has in fact already been
   passed. Anyone reading the header and the ledger together would conclude the opposite
   and might hold back commercial UI work that is not actually blocked.

## Re-application is safe, checked rather than assumed

- `0221` uses `create table if not exists` and `create index if not exists` throughout.
- `0222` uses `drop constraint if exists` followed by `add constraint`.

Both are idempotent, so a `db push` that replays them will not error and will not change
anything. **This is not urgent.** It is a bookkeeping divergence, not a broken database.

## Recommended action

Do not hand-insert ledger rows. The cheap, honest fix is a standing rule rather than a
migration: **verify schema level from the objects, never from the ledger alone.** For the
next session, the one-line check is

```sql
select to_regclass('public.org_mail_alias_provisions') is not null as has_0221,
       (select count(*) from pg_constraint
         where conname = 'distribution_run_items_channel_check'
           and pg_get_constraintdef(oid) like '%spacelist%') as has_0222;
```

Both true means the schema is at 0222 whatever `list_migrations` says.

## Status

Findings only. No migration applied, no ledger row written, no schema change.
