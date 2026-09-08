# STATUS S694: the plain-language gate is built and red on today's copy (WP0)

Date: 2026-09-08 (Session 694). Branch taken: the Meta verdict had not landed (day 5 of 20, checked 2026-09-07, no verdict), so the roadmap branch ran. Built WP0 of `claude/ROADMAP-S693-SYNDICATION-PLAIN-LANGUAGE-FOR-OPUS.md`. WP1 was not started.

**Not committed.** Four new files, a status doc, and one line in `package.json`, on the Mac, untracked. `COMMIT-S694-PLAIN-LANGUAGE-GATE.sh` commits them; it does not push. No migration, no product code, no copy change, no Meta path.

## What exists now

| File | What it is |
|---|---|
| `lib/i18n/plain-words.ts` | The section 2 word contract as data (14 rows, one approved English and French word each, 108 banned synonyms) plus the pure checkers. |
| `lib/i18n/plain-words.md` | GENERATED from that module. The gate fails when the two drift, so the table has one source of truth. |
| `scripts/test-plain-language.ts` | The gate: 219 assertions, a discovery sweep, the scan, and the ratchet. |
| `scripts/plain-language-baseline.json` | The 1,993 violations already in the copy: an allowance per file per rule, plus the exact strings as a worklist, checksummed. |
| `package.json` | `test:plain-language`. |

Ten rules: banned word, sentence over 14 words, any upper case word, dashes as punctuation, `&` or `/` inside a sentence, parentheses, copy that explains what does NOT happen, and three English and French parity rules. Unicode aware, so it still works when WP7 writes the control room in French.

Three modes:

- **default** is the commit gate. It fails when a file breaks a rule more times than the baseline allows it to. When copy improves it tightens that allowance in the same run, so a phrase you deleted cannot be pasted back tomorrow for free.
- **`--strict`** ignores the baseline and is the acceptance check for the copy sweep. **Red today: 1,993 violations, exit 1.** It goes green when the sweep finishes.
- **`--report`** lists everything, exit 0.

Plus `--regenerate-doc`, `--update-baseline` (refuses anything new or more frequent unless `--accept-new`), and `--min-offenders=N`, a floor the commit script uses.

## The number is 1,993, not 762

The first draft measured 20 surfaces and reported 762. A discovery sweep of the syndication folders then found that landlord copy lives in about twenty more modules, and that the pages are often only rendering sentences built one layer down in `lib/`. `app/dashboard/properties/[id]/page.tsx` carries 234 violations, `lib/listing-fill-sheet.ts` 200, `lib/listing-guardrails.ts` 190, `lib/distribution-publish.ts` 99, and `app/dashboard/settings/page.tsx` 117. All are now gated: **57 surfaces, 3,284 strings, 1,993 violations.**

That changes one line of the roadmap. Section 10 predicted `--strict` would go green after WP1 to WP3. It will not: WP1's scope (the catalogs and seven page files) is roughly a third of what the gate now measures. The burn-down number is the real signal, and the roadmap needs a WP for the `lib/` copy modules.

The discovery sweep is permanent. It recurses the whole dashboard subtree and the syndication modules in `lib/`, and any file that breaks the contract fails the gate until somebody either gates it, lists it in `OUT_OF_SCOPE` with a reason, or excuses its whole area in `OUT_OF_SCOPE_DIRS` (19 non-syndication areas: rent, money, maintenance and the rest). Files with clean copy need no entry, so the list maintains itself.

## Three reviewer passes, thirty findings, fourteen structural defects closed

A separate agent that had not seen the code reviewed it three times, reproducing every claim before making it: twelve findings, then ten, then eight. Each round broke the previous round's fix. The fourteen structural defects below are closed, each held down by an assertion:

1. **The ratchet keyed on text alone**, so any known-bad string could be pasted into new code for free. Counts added.
2. **Counting alone left the pawl disengaged.** Deleting a phrase and re-adding it in a later commit was free, because nothing ever pulled the baseline down. The gate now tightens the baseline whenever copy improves.
3. **The first pawl refused to tighten on a large drop**, to stop a broken scanner destroying the record. A large drop is exactly what a work package produces, so the pawl was off for every commit that mattered. It now fires on cause, not size: no excess, no assertion failure, no dropped surface.
4. **Counting exact strings punished partial fixes.** Shortening a sentence without removing its banned word read as a brand new offender. Enforcement now counts violations per file per rule; the strings stay as the worklist.
5. **`--update-baseline` silently laundered new offenders**, and was also the documented command for regenerating the doc. Split into `--regenerate-doc` and an `--update-baseline` that refuses anything new or worse without `--accept-new`.
6. **Hyphenated labels** (`Re-publish`, `Top-up`, `Done-for-you`) were read as identifiers and were invisible.
7. **Inflected verbs** (`Published`, `Launching`, `Automating`) escaped the banned list. A suffix group cannot spell `automating` from `automate`, so the real forms are built instead.
8. **Two surfaces were missing** from a hand-written list, then the sweep that replaced it **only looked one directory deep**, leaving the Copilot posting screen and 119 violations in Settings both ungated and unexcused. The sweep now recurses.
9. **The baseline was hand-editable.** A checksum was added, and `--update-baseline` refuses to re-bless an edited file.
10. **Partial blindness printed PASS**: dropping four surfaces hid 186 violations. The baseline now records which files it covers, and dropping one fails.
11. **The commit script asserted that `--strict` FAILS**, which would have inverted and blocked the commit on the day the sweep succeeded. Replaced with a floor.
12. **The pawl was triggered by the worklist but tightened the allowance.** A reword pruned an entry, printed "0 fewer occurrences", left the allowance untouched, and the real fix that followed could never tighten it again, leaving permanent free headroom. It now keys on the allowance itself.
13. **A file that reads and parses but yields fewer strings is blind, not improved.** A truncated file wiped two thirds of its own allowance and exited 0, then failed the innocent commit that restored it. The baseline now records each surface's string count, and a large fall is a hard failure before the pawl runs.
14. **The ratchet arithmetic had no self-tests.** Sabotaging the excess comparison passed all of the assertions. The comparison, the pawl condition, the tightening and the surfaces guard are now pure, exported and asserted; sabotaging any of them fails between one and five assertions.

Also fixed on the way: unicode upper case for French, an ICU fallback when braces are unbalanced, hyphen-aware ban guards so `Portal-level` fires, abbreviations (`e.g.`, `Dr.`, `Sep.`, `Mon.`) no longer splitting a long sentence into two short ones, CSS values and redirect URLs no longer read as copy, and an acronym allowlist.

**Honest about the checksum.** It catches a careless hand edit of the baseline. It does not stop a determined one: the algorithm ships in the repo, so anyone can recompute it. The real protection is that the baseline is in the diff.

**One limit, recorded rather than hidden.** Because enforcement counts per file per rule, a new violation of rule X anywhere in a file is free as long as some violation of rule X is removed anywhere in that same file. In the two largest files that is a churn budget of 234 and 181. It is the price of letting partial fixes through, and there is an assertion naming it as deliberate. If it ever bites, the fix is to key the allowance by section as well as by file.

## Proofs run

Every one of these was executed, seen to fail, and seen to pass again:

| # | Attack | Result |
|---|---|---|
| 1 | baseline state | PASS, exit 0 |
| 2 | `--strict` on today's copy | 1,993 violations, exit 1 |
| 3 | a brand new offender | exit 1 |
| 4 | pasting a KNOWN offender into new code | exit 1 |
| 5 | hyphenated labels, inflected verbs | exit 1 |
| 6 | a partial fix: shorten a sentence, keep its banned word | PASS, exit 0, baseline tightened |
| 7 | a work-package-sized clean fix, 106 occurrences | PASS, exit 0, baseline tightened |
| 8 | re-breaking that copy after the tighten | exit 1 |
| 9 | moving a banned phrase between files, same total | exit 1 |
| 10 | dropping a surface from the gate | exit 1, baseline untouched |
| 11 | raising an allowance by hand | checksum mismatch, exit 1; `--update-baseline` also refuses |
| 12 | an ungated file with bad copy: gated folder, two levels deep, sibling folder | exit 1 each |
| 13 | sabotaging the pawl, the surfaces guard, the checksum, the floor or a detector | assertion failures, exit 1 |
| 14 | truncating a gated file so it parses but yields half the strings | exit 1, baseline untouched |
| 15 | rewording, then really fixing, then spending the freed allowance | exit 1 on the third step |

`eslint` green. `tsc --noEmit` green once the unreadable duplicate files below are excluded.

## Two things found on the way that are not mine to fix

1. **Three test scripts still assert the pre-0223 `off_market` contract and are red**: `test-listing-state.ts` (2 failures), `test-rental-readiness.ts` (1), `test-reports.ts` (2). S672 fixed `lib/listing-state.ts` and re-pointed `test-property-archive.ts` at the new contract but left these three behind. They were red before this session.

2. **14 `<name> 2.<ext>` duplicate files sit in the repo, untracked** (plus more under `.next/`, which nothing reads). They are Finder or sync copies: `app/dashboard/properties/[id]/page 2.tsx` is a full duplicate of the property page, carrying its own 234 contract violations. They intermittently fail to read through the device bridge (EDEADLK), which is what breaks `tsc --noEmit` over the whole project and two unrelated test scripts (`test-no-client-secret-imports.ts`, `test-offmarket-referral.ts`) when it happens. Eight are `.ts` or `.tsx` matched by `tsconfig`: `app/dashboard/properties/[id]/page 2.tsx`, `app/api/cron/rent-increase/route 2.ts`, `app/dashboard/tenancies/[id]/utility-actions 2.ts`, `lib/lease-render 2.ts`, `lib/stripe 2.ts`, and three `scripts/test-* 2.ts`. Four `supabase/migrations/* 2.sql` and two docs make up the rest. They are untracked, so prod is unaffected. They appeared in `git status` partway through this session, after the folder was remounted. The gate skips them by name shape and prints what it skipped, so they neither pollute the baseline nor go unmentioned. They are worth deleting: nothing imports them, Next does not route them, and `page 2.tsx` will keep drifting from the real page.

## Next

WP1: the word-contract sweep of `messages/en.json` + `fr.json` and the seven property-page files. The gate is the acceptance check; run `npx tsx scripts/test-plain-language.ts --strict` for the worklist, and commit `scripts/plain-language-baseline.json` alongside each copy change so the ratchet stays tight.
