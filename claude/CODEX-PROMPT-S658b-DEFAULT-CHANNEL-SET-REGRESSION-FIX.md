# CODEX PROMPT - S658b: fix the baseline channel set regression in `f8632e0`

Repo: `vacantless-app`. Continue on the existing branch
`codex/s658-auto-distribution-org-allowlist`, worktree
`/private/tmp/vacantless-app-s658-auto-distribution`, on top of `f8632e0`.

**Do not revert the commit.** One function is wrong; everything else in `f8632e0`
is correct and stays.

## What is wrong

`defaultAutoDistributionChannelKeys` in `lib/auto-distribution.ts` does not
reproduce the pre-existing behaviour it was supposed to preserve.

The function it replaced, at `main` `e173679`
(`app/dashboard/properties/actions.ts:1867`), was exactly:

```ts
publishChannelChoices({
  includeNetworkFeed: Boolean(process.env.NETWORK_FEED_TOKEN?.trim()),
})
  .filter((channel) => channel.defaultSelected)
  .map((channel) => channel.key);
```

`publishChannelMeta` in `lib/distribution-publish.ts` sets
`defaultSelected: true` for **four** keys, not two:

- `vacantless` - `:322`
- `org_feed` - `:334`
- `facebook` and `kijiji` - `:382`

and explicitly sets `network_feed` to `defaultSelected: false` at `:346`.

So the true baseline auto-staged set is
**`{vacantless, org_feed, facebook, kijiji}`**. This is confirmed by live
evidence: S657 turned `AUTO_DISTRIBUTION_ENABLED` on and the run it produced,
`bdc12c9d`, contained items for vacantless, org_feed, kijiji and facebook.

The new function instead:

1. **Drops `vacantless` and `org_feed`** via the explicit
   `channel.key !== "vacantless" && channel.key !== "org_feed"` conditions.
2. **Adds `network_feed`** whenever `includeNetworkFeed` is true, via the
   `if (channel.key === "network_feed") { if (includeNetworkFeed) keys.add(...) }`
   branch, ignoring that its `defaultSelected` is `false`.

Either one is a production behaviour change on the first org that gets the flag.

**This is my error, not yours.** Acceptance criterion 5 in the S658 prompt told
you the baseline was "`facebook`, `kijiji`, plus `network_feed` when
`NETWORK_FEED_TOKEN` is set". That was wrong on both counts, and the test you
wrote faithfully encodes it, which is why the harness reports 20 passed while
the behaviour is incorrect.

## The fix

Replace the body of `defaultAutoDistributionChannelKeys` so it is a pure
`defaultSelected` filter with **no per-key special cases at all**:

```ts
function defaultAutoDistributionChannelKeys(
  includeNetworkFeed: boolean,
): Set<PublishChannelKey> {
  const keys = new Set<PublishChannelKey>();
  for (const channel of publishChannelChoices({ includeNetworkFeed })) {
    if (channel.defaultSelected) keys.add(channel.key);
  }
  return keys;
}
```

Nothing else in `lib/auto-distribution.ts` changes. Nothing in
`app/dashboard/properties/actions.ts` changes. Do not touch
`lib/distribution-publish.ts`.

## Test corrections in `scripts/test-auto-distribution-org-allowlist.ts`

1. Fix the criterion 5 case: with no account rows, `autoDistributionChannels`
   must return **exactly** `["vacantless", "org_feed", "facebook", "kijiji"]`
   in `PUBLISH_CHANNEL_KEYS` order. Assert the full array, not a subset.
2. Add a case: `includeNetworkFeed: true` with no account rows must return that
   **same** four-key array. `network_feed` must be **absent**, because its
   `defaultSelected` is `false`. This is the assertion that would have caught
   the bug.
3. Re-check every other case that asserted on the baseline set and widen it to
   the four keys. The instagram and facebook_feed cases should now expect the
   four baseline keys **plus** the authorized channel.
4. Keep criterion 10 as is - the `zumper` / `rentals_ca` / `rentfaster` /
   `viewit` exclusion test is correct and valuable.

## Verify and report

- The S658 harness, all green.
- `./node_modules/.bin/tsc --noEmit`, `npm run lint`, `npm run build`.
- `git diff main...HEAD --stat` and the final commit sha.
- Explicitly print the array returned by `autoDistributionChannels` for: no
  accounts; no accounts with `includeNetworkFeed: true`; and instagram
  connected + authorized. I want to read the three actual sets, not just a pass
  count.

Commit on the same branch. Do not push, merge, deploy, or change env.
