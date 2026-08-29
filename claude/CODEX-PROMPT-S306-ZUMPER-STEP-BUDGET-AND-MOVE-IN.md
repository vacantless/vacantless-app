# CODEX PROMPT S306: a past availability date silently eats the whole Zumper step budget

Repo: vacantless-worker (parts 1 to 3), vacantless-app (part 4)
Evidence: claude/FINDINGS-S306-ZUMPER-DARK-STOPPED-AT-THE-STEP-CAP.md
Attempts: 7a7801e9 (14 steps), 9bb31baa (24 steps), both stalled on lease-details

## What happened

833 Pillette Unit 20 carries `available_date = 2026-08-01`. On 2026-07-24 that date was in
the future, the Zumper react-calendar tile was enabled, `zumper-move-in` filled, the
wizard advanced, and the run published. On 2026-08-29 the same date is 28 days in the
past. Past tiles are disabled (documented in mappings/zumper.json), the 'Set to' fallback
is absent, the required field stays empty, the lease-details step refuses to advance, and
the wizard loop clicks a rejected Next until MAX_WIZARD_STEPS runs out.

Raising `ZUMPER_MAX_STEPS` from 14 to 24 produced ten more iterations, zero more filled
fields, and the same stall. The step budget was never the problem.

The runner reported this as `outcome: review_not_reached` with `zumper-rent` not_found and
`photos_attached: 0`, both of which are just "the run never reached those steps". Nothing
in the output pointed at the date. That is the defect to fix: not the fill, the silence.

## Part 1: refuse a past date before the browser opens

In src/compose.ts, `composeZumperFillValues` (and the equivalent for any other channel
that composes an availability or move-in date):

`available_date` in the past relative to today is not a valid value. Today it is passed
through and fails deep inside a calendar widget. Instead, treat it like the other compose
failures: do not put it in `values`, push a specific reason onto `missing`, and make the
reason legible, for example `zumper-move-in(available_date 2026-08-01 is in the past)`.

Then decide the policy explicitly, in code, with a comment saying which was chosen and
why. Two defensible options:

  (a) Hard stop. `composed.ok = false` with reason `available_date_past`, the runner
      releases the item back to needs_operator with that audit line, and no browser opens.
      Cheapest, loudest, and correct: an ad that says it was available four weeks ago is
      wrong copy regardless of whether the form accepts it.
  (b) Roll forward to today (or the next day) and record the substitution in the attempt
      metadata so nobody later thinks the listing data was fine.

Prefer (a). Do not silently roll forward without recording it.

## Part 2: stall detection in the wizard loop

src/phase-b-submit-zumper.ts, the `for (let step = 0; step < MAX_WIZARD_STEPS; step++)`
loop. Today it cannot tell "advanced" from "clicked a button that did nothing".

1. Capture `page.url()` before the Next click and after the settle.
2. Record one row per iteration in a bounded `step_trace` array:
   `{ step, path_before, path_after, advanced, filled_this_step, next_found, publish_found }`.
   Paths only, not full URLs. Cap the array at MAX_WIZARD_STEPS entries.
3. If `advanced` is false for N consecutive iterations (N = 3, `ZUMPER_STALL_LIMIT`),
   break with `outcome = "wizard_stalled"`, and record `stalled_at_path` and
   `stalled_after_steps`.
4. On stall, before breaking, take a screenshot and capture the text of any visible
   validation or error element into `stall_reason`. A stalled step is nearly always a
   required field the runner left empty, and the page usually says which one.
5. Split the exits. `step_budget_exhausted` and `wizard_stalled` and "no Next and no
   Publish" are three different facts currently collapsed into `review_not_reached`.
6. Add `step_trace`, `stalled_at_path`, `stall_reason` and `max_wizard_steps` to the
   attempt metadata.

Leave the default `MAX_WIZARD_STEPS` at 14. With stall detection the cap stops being the
thing that ends bad runs, and 14 was demonstrably sufficient on 2026-07-24.

## Part 3: do not report unreached steps as field failures

When the loop exits without reaching Review, every mapping field belonging to a step that
never rendered comes back `not_found`, which reads exactly like a broken selector. Two
sessions were spent on `[aria-label="Monthly rent"]` for this reason.

Add a third status alongside `filled` / `not_found` / `skipped:no_value`, something like
`not_reached`, for fields whose step the run never rendered. If that is hard to determine
precisely, the cheaper version is enough: when `reached_review` is false, add a metadata
flag `field_results_incomplete: true` with a one-line note that not_found on an unreached
step is not evidence about the selector.

## Part 4 (vacantless-app): surface stale availability dates before a run is queued

A property with `available_date` in the past is bad listing copy on every channel, not
just a Zumper blocker. Add a check where the operator can act on it: flag properties with
active or approved distribution items whose `available_date` is earlier than today, on the
property page and in whatever the distribution rail shows before submit. Wording should be
plain, for example "Availability date has passed. Update it before this goes out."

## Constraints

- Dark mode behaviour must not change: no Publish click, approval preserved, item released
  back to needs_operator.
- Do not touch `PHOTO_INPUT_SELECTOR` (the s561 bug) or the datepick calendar-stepping
  logic (captured live, documented in the mapping).
- Do not add any new irreversible click target. Next, Publish, Boost decline. That is all.
- Keep `step_trace` bounded so attempt metadata does not bloat.

## How to verify

Set a future `available_date` on 833 Pillette Unit 20 and run `submit:z:dark` against
Agile item 35dceeeb. Expected: `zumper-move-in` filled, lease-details advances, the run
reaches review-and-publish with rent filled and photos attached.

Then set it back to a past date and run again. Expected: compose refuses before the
browser opens, with `available_date_past` in the audit line. That second run is the actual
regression test, because it is the case that cost a month.

Note for whoever runs it: every run mints a new draft listing on Agile's real Zumper
account. 65213174 and 65213477 are two such drafts. They accumulate and need clearing by
hand.
