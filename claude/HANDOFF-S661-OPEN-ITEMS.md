# HANDOFF - S661 open items, in dependency order

_2026-08-17. Every command below is paste-ready with no placeholders. Verified against the live
repo: remote is `origin` = `https://github.com/vacantless/vacantless-app.git`, both branches exist
locally, **neither is on origin**, and **`gh` is not installed** so PRs are opened in the browser._

**Why none of these are done for you:** pushing is a git write on the Mac bridge (standing rule, and
`device_bash` has no network anyway); the orphan step is irreversible deletion; and applying a
migration from an unmerged branch would put the prod database ahead of prod code. All four are
yours by design, not by omission.

---

## 1. Ship the stale-render fix. Nothing blocks this.

`codex/s660-channel-mutation-stale-render` = **817f23b**, warm-verified in S661. No migration, no env
var, no flag, independent of the photo lane.

```
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app" && git push -u origin codex/s660-channel-mutation-stale-render
```

Then open the PR:

https://github.com/vacantless/vacantless-app/compare/main...codex/s660-channel-mutation-stale-render?expand=1

After merge, confirm what actually went live rather than trusting the merge (KI941 - "committed" is
not "pushed" is not "deployed"):

```
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app" && git --no-optional-locks fetch origin && git --no-optional-locks rev-parse --short origin/main
```

Prod is `3084501` until that changes. Ask me to confirm the Vercel deploy reached READY and that the
deployed SHA matches, and I will read it from the Vercel MCP rather than inferring.

**Live check worth doing once deployed**, because this is the bug's actual signature: on a QA
sandbox org, trigger the same outcome twice in a row without reloading (two authorizations, or the
same failing action twice) and confirm the rail re-renders both times. Not on Growth Test.

---

## 2. Delete the 19 orphaned objects. IRREVERSIBLE - read the correction first.

**The count is 19, not 37.** The 18 objects under the Agile prefix are Agile's OWN live listing
(`ab3a44a0`, 833 Pillette Rd Unit 3) and all 18 of its photo rows point at them. Deleting by prefix
would destroy a live customer's photo set. Delete by REFERENCE COUNT only.

Dry run first - prints exactly what it would remove and what it refuses:

```
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app" && node --env-file=.env.local scripts/delete-orphaned-photo-objects-s661.mjs
```

Expect `found=19 deletable=19 refused=0`. **If `refused` is anything but 0, do not proceed** - the
script aborts by design and something has changed since 2026-08-17.

Then, only if the dry run is clean:

```
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app" && node --env-file=.env.local scripts/delete-orphaned-photo-objects-s661.mjs --apply
```

Afterwards open both public pages and confirm 11 and 8 photos still render:
- https://app.vacantless.com/r/7886fe96-865f-4dc7-86b8-e2acd0138047
- https://app.vacantless.com/r/da08230f-81d6-47ce-a75b-116639c10a5a

This is optional. 19 objects cost pennies. There is no deadline and nothing depends on it.

---

## 3. Resolve the crossorg branch, then ship it.

`codex/s660-crossorg-photo-storage` = **c41f000**, local only. The DATA it was written to fix is
already fixed; what remains is code.

**Recommendation: have Codex DELETE `scripts/rehome-property-photo-prefixes.mjs` rather than grant
the privilege.** It was a one-off remediation that is now complete, and keeping it runnable costs a
permanent `service_role` write grant on `property_photos`. Full reasoning is in the amended
`claude/CODEX-PROMPT-CROSSORG-PHOTO-STORAGE-S660.md`.

Changes 2, 3 and 5 in that branch are good and should ship: the swallowed-`copyErr` fix, the
cross-prefix admin copy (verified sound - `service_role` DOES have full DML on `storage.objects`),
and the tests.

Push and PR the same way as step 1:

```
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app" && git push -u origin codex/s660-crossorg-photo-storage
```

https://github.com/vacantless/vacantless-app/compare/main...codex/s660-crossorg-photo-storage?expand=1

---

## 4. Apply migration 0215 - LAST, and only after step 3 merges.

`0215_property_photos_storage_prefix_guard.sql` is now satisfiable: every row in the table passes all
three of its conditions. But **do not apply it from an unmerged branch** - that puts the database
ahead of the code and leaves drift if the branch is revised in review.

Order: merge step 3, re-confirm the audit query returns **zero rows**, then apply.

```sql
select p.id, p.address, o.name as org, split_part(ph.storage_path,'/',1) as prefix, count(*)
  from property_photos ph
  join properties p on p.id = ph.property_id
  join organizations o on o.id = p.organization_id
 where p.organization_id::text <> split_part(ph.storage_path,'/',1)
 group by 1,2,3,4;
```

Ask me and I will run that check and apply the migration through the Supabase MCP once the branch is
merged.

---

## Not on this list, deliberately

- **Meta.** App Review is in review and frozen. First meaningful check **2026-08-24**
  (`trig_01NkARdwoKjFD7evxNXCdUrc`). Access Verification is CLOSED and verified. Do not delete the
  two live Meta posts, do not widen `IG_CHANNEL_ORG_ALLOWLIST`, do not touch the submission.
- **Gate 2** (`publishProperty` no-ops on an already-live listing) and **gate 5** - both still open,
  both blocking nothing.
