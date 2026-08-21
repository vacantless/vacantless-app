# CODEX PROMPT - fix the comma splice in the S655 marketing copy (S655b, 2026-08-14)

Follow-up to `claude/CODEX-PROMPT-MARKETING-SITE-META-CHANNEL-VISIBILITY-S655.md`. Two characters. Read the state warning first.

## STATE WARNING - the S655 change is UNCOMMITTED, do not destroy it

As of 2026-08-14 23:56 UTC [verified via read-only git]:
- Branch `codex/s655-marketing-meta-copy` is at `ede4486`, **identical to `main`**.
- The S655 edit exists ONLY as working-tree state: `git status` shows ` M app/page.tsx`, and `git diff main...codex/s655-marketing-meta-copy` is **empty**.

So a `git checkout`, `git reset --hard`, `git stash` without a pop, or a branch switch will **silently erase the S655 work**. Before touching anything:

```
git status --porcelain          # expect: " M app/page.tsx"
git diff -- app/page.tsx        # expect: the 2-hunk S655 edit (+3/-1)
```

If that diff is missing, STOP and report; do not re-implement from memory. If it is present, make the fix below in the working tree and then commit the whole S655 change as one commit.

## THE FIX

**File:** `app/page.tsx`, `LeasingProof` section head body (around line 376).

The current sentence is a comma splice: it joins two independent clauses with a comma. The sibling `NeverMiss` section directly below uses clean sentence breaks ("Filling the unit is the start. The money leaks later..."), so this reads as sloppier than the copy around it, on the homepage, in front of the Meta reviewer it was written for.

Current:
```
          You publish the listing to your own Facebook Page and Instagram,
          renters find your page, book their own viewing time, and land in one
          list. Here is how that plays out across our own rentals.
```

Change to:
```
          You publish the listing to your own Facebook Page and Instagram.
          Renters find your page, book their own viewing time, and land in one
          list. Here is how that plays out across our own rentals.
```

That is exactly two character changes: the comma after `Instagram` becomes a period, and `renters` becomes `Renters`. Keep the existing JSX line wrapping as shown; JSX collapses the whitespace, so the visual line breaks do not affect the rendered sentence.

## DO NOT

- Do NOT touch the `PRODUCT_GROUPS` bullet added in S655. It renders correctly as the fourth item under "Advertise the rental" and the conditional Instagram wording is deliberate.
- Do NOT reword anything else, rename the section, or change `SectionHead title`.
- Do NOT push, open a PR, deploy, flip flags, or touch production. Local branch only.

## ACCEPTANCE CRITERIA

1. `app/page.tsx` is still the only changed file.
2. `npx tsc --noEmit` clean; `npm run lint` clean; `npm run build` succeeds.
3. The rendered homepage contains this exact sentence: `You publish the listing to your own Facebook Page and Instagram. Renters find your page, book their own viewing time, and land in one list.`
4. The rendered homepage still contains the bullet `Post straight to your own Facebook Page, and to Instagram once connected`.
5. **After committing**, `git diff main...codex/s655-marketing-meta-copy --stat` shows `app/page.tsx | 4 +++-` and is NOT empty. This is the check that S655 actually landed as a commit rather than staying loose in the working tree.

## THEN

Report the commit SHA. Noam pushes and merges from his own terminal; Cowork must not run git writes on the Mac through the device bridge (they strand `.git/*.lock` and break the next git write, KI1070 / standing rule 63).
