# CODEX PROMPT - S661 follow-up. Two small cleanups on work you already built.

Repo: `vacantless-app`. **Do not start either S660 prompt from scratch - you already built both.**
`codex/s660-channel-mutation-stale-render` (`817f23b`) and `codex/s660-crossorg-photo-storage`
(`c41f000`) exist and were reviewed in S661. This is a follow-up, not a re-run.

**The DATA problem is already fixed. Do not run any re-home, and do not write a new one.** All four
affected listings were corrected on 2026-08-17 and the audit query returns zero rows. Record:
`claude/STATUS-CROSSORG-PHOTO-REHOME-S661.md`.

---

## Task 1 - on `codex/s660-crossorg-photo-storage`: delete the dead script

`scripts/rehome-property-photo-prefixes.mjs` **cannot run**. `--apply` aborts at its own
`preflightUpdatePrivilege` with `permission denied for table property_photos`, because `service_role`
holds only `SELECT` on that table. A legacy `service_role` JWT fails identically, so this is not an
environment or key problem [verified 2026-08-17 via `information_schema.role_table_grants`].

**Delete the script.** It was a one-off remediation and the remediation is complete. Keeping it
runnable would cost a permanent `service_role` write grant on a table holding customer listing
photos, to serve a need that no longer exists.

If you believe it should be kept instead, then add
`grant update on public.property_photos to service_role;` as its **own migration in this branch**,
and say plainly in the PR description that it widens service-role privilege. Do not add it silently
alongside other changes. Note `property_photos` is one of 13 public tables where `service_role` is
deliberately or accidentally read-only, alongside `rental_applications` - so a blanket sweep is not
the answer either.

**Keep changes 2, 3 and 5 exactly as built.** They were reviewed and are sound:
- the swallowed `copyErr` fix plus `photoCloneResultParam` and the amber banner at `page.tsx:2393`
- the admin-client cross-prefix copy (confirmed safe: `service_role` DOES have full DML on
  `storage.objects`, and the ownership gate via the RLS-scoped `properties` read runs first)
- both test harnesses

One note on change 2: `photoerr` is now overloaded, carrying both upload errors (`type`, `size`) and
clone outcomes (`copy0`, `copypartial`), with an exclusion guard at `page.tsx:2484` keeping the old
red banner from double-firing. That works today. A short comment at both render sites explaining the
split would stop a future edit from breaking it.

Migration `0215` stays in this branch and is now satisfiable, but **do not apply it** - Noam applies
it after merge, once the audit query is re-confirmed at zero.

---

## Task 2 - on `codex/s660-channel-mutation-stale-render`: two review notes

The fix is correct and shipping. These are follow-ups, not blockers, and can land as a separate
commit on the same branch or a new one.

1. **`readInstantPublishDestinations` relies on RLS alone for ownership.** Every neighbouring action
   in `distribution-actions.ts` uses the explicit `requireCurrentOrgProperty(supabase, propertyId,
   org.id)` helper; this one reads `properties` by id and leans on the RLS scoping to return null
   for a foreign property. That is sufficient today, but it is inconsistent with the file's own
   pattern, and this project has a repeated history of cross-org identity defects. Use the helper.

2. **`ConfirmPublishButton`'s `destinations.length === 0` early return reads the STALE prop.** It
   returns a bare form with no confirm modal, before the fresh server read is ever consulted. With
   the `m=` token in place I could not construct a path where the prop is empty while the server has
   destinations - but "I could not construct a path" is exactly what was believed about the original
   bug. Since that early return is the one remaining place the KI999 "nothing posts before the
   confirm modal" invariant rests on props, consider deriving it from the fresh read too, or add a
   comment stating why the prop is trustworthy there.

---

## Standing constraints

Build only; do not push, open a PR, deploy, apply a migration, change any env var or flag, or touch
anything on Meta. App Review is in review and frozen. Report the branch, commit SHA, files changed,
and your test output.
