# RECOMMENDATION S306: do not light the paid Kijiji lane yet

Date: 2026-08-29. A recommendation to Noam, not a decision. Nothing was spent, armed or deployed.
Reads against: vacantless-worker src/claim.ts, mappings/kijiji.json, vacantless-app git history,
distribution_publish_attempts.

## First, a correction I owe the record

Earlier this session I said Kijiji was "blocked by money, with nothing technical left in it."
That was too clean. Two of the four S667 prerequisites really are done, which I had not checked:

- **Per-org spend authorization is BUILT and is in the claim predicate.** `claim.ts` selects
  `spend_authorized, spend_max_cents, spend_period_max_cents, spend_revoked_at`, refuses at `:72`
  with `spend_not_authorized`, writes `error_code: "spend_authorization_required"`, and excludes
  those rows from re-claim at `:120`. This is the thing S667 called the hard prerequisite. It
  shipped in `ec767d6` (S279 worker spend claim reconciliation).
- **The duplicate-post guard is MERGED.** `6f262dc` is an ancestor of `main`. Under a paid model
  each duplicate would cost $29.95, so this genuinely had to land first, and it has.

So the build is further along than the S667 order-of-work implies. But "further along" is not
"nothing left", and what remains is the riskiest part.

## What actually remains before a paid Kijiji post can happen

1. **The paid lane is still dark by construction.** `mappings/kijiji.json` `_meta.paidPlan` has
   `basePackageCode: ""` and `savedMethodNames: ["^RECON_PENDING_SAVED_METHOD_NAME$"]`, a
   deliberate never-match sentinel. Filling those in requires a live reconnaissance pass through
   Kijiji's real checkout on a real account with a card on file. That is the single most
   consequential live portal action in this project and it should be its own session, planned,
   not a step inside a Friday afternoon.
2. A per-org ceiling written onto Agile's `distribution_channel_accounts` row.
3. A worker deploy.

## The number that should drive the decision

Every Kijiji attempt ever recorded, by org:

| org | attempts | live-mode runs | ever published |
|---|---|---|---|
| Abbas Husain | 337 | 0 | **0** |
| Agile Real Estate Group | 202 | 12 | **0** |
| Growth Test | 57 | 29 | **0** |
| North Star QA | 2 | 0 | **0** |
| **total** | **598** | **41** | **0** |

598 attempts. 41 of them in live mode. **Zero ads produced, on any org, on any date.** Agile's
last Kijiji attempt of any kind was 2026-08-14, fifteen days ago.

(Caveat, stated because it matters: Abbas's 337 are freshness-cron rows on one stale item, not
posting attempts. Agile's 202 and Growth Test's 57 are the real signal. The zero is unaffected.)

## The recommendation

**Defer.** Not "never", and not because the work is bad. Three reasons:

1. **Sequencing.** Zumper is one rerun from being a working FREE channel for Agile, and that
   window closes 2026-09-02 when the availability date goes past again. The next 72 hours are
   worth more spent there than on lighting a paid lane.
2. **Evidence.** Paying $29.95 an ad to enter a channel that has produced nothing in 598 attempts
   is buying a hypothesis. Facebook Marketplace is already delivering for the same units (Unit 20:
   84 lifetime leads). Kijiji's marginal value over that is unmeasured.
3. **Blast radius.** The remaining step is a live checkout recon with a card on file. Doing that
   while a separate lane is mid-proof is how mistakes compound.

## What would change the answer

Prove Zumper end to end first. If a headless channel can carry a listing from queued to live with
photos and correct copy, then the same machinery pointed at a paid Kijiji lane is worth $29.95 a
test, because the surrounding system will have earned the benefit of the doubt. Today it has not.

S667 already anticipated this and named it: *"Whether Kijiji is worth it at all once it is paid...
Revisit after the first paid month with real numbers, and be willing to take option D."* This
recommendation is that the revisit happens BEFORE the first paid month, not after, because the
zero is already a real number.

---

# CORRECTION 2026-08-29: Kijiji HAS produced leads. The recommendation above is partly wrong.

Noam pushed back on the zero. He was right and I was wrong.

## The error

"598 attempts, zero published" is a true statement about the **worker automation**. It means the
robot has never successfully posted a Kijiji ad. I then used it as though it were a statement
about **the channel**, and wrote that paying for Kijiji would be "buying a hypothesis". That does
not follow. Kijiji ads have existed at 833 Pillette and elsewhere, posted by hand, and they
produced real renters.

## The evidence, from Noam's own mailbox

Gmail search `"Source: Kijiji" subject:"New Lead"` returns **16 threads**, roughly 18 messages
counting duplicate sends, all Zapier lead alerts to `rentals@agileonline.ca` (Aaliyah) copied to
Peter. They run **2026-05-06 through 2026-07-03**. Named renters include Princess, Naw dah, Mini,
Rudra thakkar and Dee Dee.

Supabase, by contrast, holds only **4** leads with `source = 'Kijiji'`, dated 2026-06-16 to
2026-06-27. So Vacantless recorded about a quarter of them. The rest reached Aaliyah through the
Zapier and Calendly path and never entered the product at all.

That is the same attribution blindness this session has been chasing all day, and it is why a
Supabase-only read produced a confident wrong answer. **A zero from a query is a claim about the
query, not about the world.** That rule was already written down in this project after an earlier
version of the same mistake, and I made it again.

## The other thing the dates say

The Kijiji leads stop on 2026-07-03. That lines up with the Kijiji ads coming down
(`claude/FINDINGS-KIJIJI-ACCOUNT-HEALTHY-ADS-SELF-DELETED-S666.md`). The channel did not fail.
The ads went away and the leads went with them.

## What survives of the recommendation, and what does not

DEAD: the evidence argument. Kijiji is a proven lead source for these exact units, at roughly
16 leads over two months while ads were up. It is not a hypothesis.

STILL STANDS: the sequencing argument. The paid lane's last step is a live reconnaissance pass
through Kijiji's checkout with a card on file, and that deserves its own planned session rather
than a weekend. The Zumper window closes 2026-09-02.

NEW AND CHEAPER QUESTION, which should have been asked first: **the 16 leads came from ads posted
by hand, not by the worker.** So the fastest way back to Kijiji leads is probably to put the ads
back up the way they went up before, and treat the paid automation as a separate, later project.
That costs nothing to ask and was completely obscured by the wrong framing above.

## Standing rule, reinforced

Before characterising a channel as dead, check where its leads would actually land. For Agile
that is Aaliyah's mailbox (`rentals@agileonline.ca`, and her Roundcube account), not only
Supabase. The product does not see most of them.

---

# SUPERSEDED 2026-08-29 by the Roundcube read

Read `claude/FINDINGS-S306-KIJIJI-HAS-DELIVERED-1032-ENQUIRIES-TO-AALIYAH.md` instead.

Kijiji has delivered **1,032 renter enquiries** to `rentals@agileonline.ca` since 2024-05-03, most
recently 2026-08-13, running at roughly 8 a month in 2026 including 8 for 833 Pillette between
June 22 and August 13. Agile is also **already paying** for Kijiji ads, order confirmation
#CA20036847018 dated 2026-07-24.

Everything in the recommendation above that rests on Kijiji being unproven is void. The only
part that survives is the narrow sequencing point: letting the WORKER spend money automatically
still needs the checkout recon, and that still deserves its own planned session rather than being
squeezed in beside the Zumper work.

The real question was never "should Agile pay for Kijiji". It has been paying. It is "should the
robot be allowed to pay", which is a smaller question with a smaller downside, and the answer is
much more likely yes than what I wrote above implied.
