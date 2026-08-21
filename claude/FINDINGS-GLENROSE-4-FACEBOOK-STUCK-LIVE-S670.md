# 50 Glenrose Unit 4: Facebook row is stuck on "live" and can never age out

Session 670, 2026-08-20. Read-only investigation. Nothing was written.

## What Noam reported

In Abbas' account, 50 Glenrose Unit 4 offers a link to the live listing. The link opens a page, but the ad is not actually live.

## Confirmed

Org **Abbas Husain** `b2cb4eab-9a29-4972-8fca-564dc8ca6a61`.
Property **50 Glenrose Ave, Unit 4** `7886fe96-865f-4dc7-86b8-e2acd0138047`, status `available`, not archived.

Two `listing_posts` rows:

| id | portal | status | url | posted_on | created |
|---|---|---|---|---|---|
| `de093e27-4097-4323-826b-44ce1cbe30f5` | facebook | **live** | facebook.com/share/1BYLMy84Fo/ | **null** | 2026-07-06 |
| `65e28bc8-8d2b-4981-8ee1-6c95b1e1a664` | kijiji | expired | kijiji.ca/...1740198922 | null | 2026-07-06 |

Kijiji is correctly marked expired. Facebook has said `live` for **46 days** and nothing has ever contradicted it.

The reason the link "opens a page" rather than 404ing is that `facebook.com/share/...` never hard-fails. A removed Marketplace ad resolves to a generic Facebook page. So the app's link looks valid and the ad is gone.

## Root cause: the freshness cron cannot flag this row, permanently

`distribution_verifications` for this property: **112 rows, and not one of them is facebook.** 101 kijiji, 8 org_feed, 3 vacantless.

The facebook run item exists and is eligible. `distribution_run_items` `38bd3e77-b9b0-4244-a550-23b32223cf80`, channel `facebook`, `publish_status='live'`, `verification_status=null`, `listing_post_id=de093e27`, `stale_after=null`, `next_retry_at=null`.

Trace it through `portalFreshnessDecision` in `lib/distribution-freshness.ts`:

1. `status === "expired" || "removed"` -> no, it is `live`.
2. `status === "live" && !listingPostUrl` -> no, the url is present.
3. `const due = freshnessDue(input); if (due.due && due.pointer)` -> **this is the hole.** The pointer is `nextCheckAt ?? staleAfter ?? nextRetryAt`, and all three are null. `freshnessDue` correctly returns `{ due: true, pointer: null, reason: "no_pointer" }`, but the guard requires `due.pointer` to be truthy, so a never-scheduled item is skipped. An item that has never been checked is the one that most needs checking, and it is the exact case this guard excludes.
4. `posted_on` is null, so `daysBetween(null, today)` returns null, `age == null`, and the `posted_on_stale` branch cannot fire either.
5. Falls through to `{ shouldFlag: false, reason: "not_due" }`.

Both escape hatches need either a pointer or a `posted_on`. This row has neither. It is not stale, it is **unreachable**. It will read `live` forever.

Kijiji only got caught because a human had already set its `listing_posts.status` to `expired`, which hits branch 1. The cron did not discover that lapse. It echoed a value a person typed.

## Second, larger point: nothing ever checks the portal

Even when the cron does flag a portal channel, `flagPortalForRefresh` in `app/api/cron/distribution-freshness/route.ts` writes `matchedFields.externalPortalChecked: false` and this failure reason, verbatim from the source:

> "Portal refresh is due. The freshness cron does not log into or submit to external portals."

So the system never verifies that an external ad is still up. `listing_posts.status = 'live'` is an operator assertion with no expiry and no independent confirmation. The freshness cron re-reads the tracker's own value and reports it back as a verification, which is why kijiji has 101 identical "verified" rows all saying the thing a human already said.

**Correction to an earlier claim in this session.** I first said Abbas' org has no Relist Radar coverage because `relist_radar_settings` has zero rows for it. That is wrong. `loadRelistRadarSettingsForOrg` calls `resolveRelistRadarSettings(undefined)`, which falls back to `RELIST_RADAR_DEFAULT_SETTINGS` (`lib/relist-radar.ts`), and that object has no on/off switch at all, only behavioural preferences. A missing row means the org never customised the radar, not that it is uncovered. Why the radar still produced zero `relist_radar_events` for this property is a separate open question and is not traced here.

## Blast radius

Rows that currently claim `live` on an available, non-archived property:

| org | portal | rows | posted_on null | oldest |
|---|---|---|---|---|
| Abbas Husain | facebook | 1 | **1** | 2026-07-06 |
| Agile Real Estate Group | facebook | 4 | 0 | 2026-07-01 |
| Growth Test | facebook_feed | 1 | 1 | 2026-08-16 |
| Growth Test | instagram | 1 | 1 | 2026-08-16 |

Agile's four all have `posted_on` set, so they can still age out through branch 4. Growth Test is the QA org.

**Abbas' Unit 4 is the only production row where both escape hatches are closed.** That is why this is the one that surfaced.

## How this connects to the S670 review

The S670 branch would have made this worse, not caused it. B1 in that review has the Rentals list counting raw `listing_posts` rows with no status filter, so Unit 4 would read `Live on 2 sites` there, counting the correctly-expired Kijiji row alongside the wrongly-live Facebook one. The underlying defect is this one and it exists on PROD `3cabc01` today.

## Recommended fixes, smallest first

**1. Correct the row now (one line, needs Noam's go-ahead since Abbas is a live org).**

```sql
update listing_posts set status = 'expired'
where id = 'de093e27-4097-4323-826b-44ce1cbe30f5';
```

Confirm the ad is really gone first. Read it back after.

**2. Close the `no_pointer` hole (one line, real fix).**
In `portalFreshnessDecision`, change

```
if (due.due && due.pointer) return { shouldFlag: true, reason: "pointer_due" };
```

to flag on `due.due` regardless of pointer, or add an explicit `reason === "no_pointer"` branch. A live portal row that has never been scheduled for a check should be flagged on the first cron pass. Guard it so a newly created row gets one grace period rather than flagging the instant it is posted.

**3. Prefer this over fix 2: give the age branch a fallback clock.** `DEFAULT_REFRESH_DAYS` is **14** (`lib/distribution-channels.ts:595`). Pass `posted_on ?? created_at` as the age input so a row is never ageless. Checked against today's data this flags **exactly one row**, Abbas' (46 days old), and nothing else: Agile's four Facebook rows already have `posted_on`, and Growth Test's two are 5 days old, under the window. Dropping the `&& due.pointer` guard instead is broader and would flag healthy rows that simply lack a pointer, which is a false-alarm storm on live orgs. Do the clock fallback, not the guard removal.

**4. The honest one, bigger.** Either build a real portal probe, or stop calling an unverified operator assertion "live" in the UI. Today the word Live on a Facebook or Kijiji row means "someone typed this once", and the S670 copy leans harder on that word, not lighter.
