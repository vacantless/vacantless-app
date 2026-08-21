# CODEX PROMPT - S658: org-allowlist auto-distribution + stage authorized instant channels

Repo: `vacantless-app`. Base: `main` at `e173679` (S657 merges already in).
Branch: `codex/s658-auto-distribution-org-allowlist`

## Why

Session 657 found the `api_automatic` publish lane blocked four gates deep.
S658 merged `bed6786` and closed **gate 1** - `automation_authorized` can now be
set true from the product (proven live: Growth Test instagram row,
`automation_authorized_at=2026-08-16 01:58:49Z`, `automation_authorized_by`
populated).

Gates 3 and 4 are still shut, and gate 5 (new, found in S658) means the run
panel that would let an operator tick Instagram by hand is not even rendered in
production:

- **Gate 3.** `maybePrepareAvailableListing` reads
  `envFlagEnabled(process.env.AUTO_DISTRIBUTION_ENABLED)` (`actions.ts:1882`).
  The var is unset in production, so no run is ever staged, so
  `publishAuthorizedInstantChannelsAfterPageLive` returns at `if (!runId) return`
  (`actions.ts:1024`). Turning it on as-is would turn auto-distribution on for
  **every org at once**, which is exactly the blast radius the S650 and S656
  allowlists were built to avoid.
- **Gate 4.** `autoDistributionChannels()` (`actions.ts:1867`) filters
  `publishChannelChoices()` to `channel.defaultSelected`, and `defaultSelected`
  is hardcoded `key === "facebook" || key === "kijiji"`
  (`lib/distribution-publish.ts:382`). So an auto-staged run can never contain
  `instagram` or `facebook_feed`, and the autofire has nothing to select.
- **Gate 5 (context only, DO NOT fix here).** `PUBLISH_SIMPLE_DEFAULT_ENABLED`
  is `"true"` in production, so `distribute-tab.tsx:814` renders the simple
  surface only, `GetOnlineView` never mounts, and `LaunchRunPanel` - the sole
  caller of `startDistributionRun` - is unreachable. That is why this fix has to
  make the **automatic** path work rather than relying on the panel.

The goal is the real customer flow, the one the Meta App Review screencast has
to show: connect Instagram, click Authorize auto-post, set the listing Live, and
the post goes up on its own. No SQL, no hand-ticked panel, no global flag.

## Scope

Two changes. Nothing else.

### Change 1 - org-scope the auto-distribution gate

Mirror `igChannelEnabledForOrg` in `lib/facebook-page-oauth.ts:77-99` exactly.
Put the new code wherever it sits most naturally alongside the existing
auto-distribution logic; a new small module is fine.

- `parseAutoDistributionOrgAllowlist(value)` - comma separated, lowercased,
  UUID-validated, same as `parseIgChannelOrgAllowlist`.
- `const AUTO_DISTRIBUTION_ORG_ALLOWLIST = parseAutoDistributionOrgAllowlist(process.env.AUTO_DISTRIBUTION_ORG_ALLOWLIST)`
- `autoDistributionEnabledForOrg(organizationId, allowlist = AUTO_DISTRIBUTION_ORG_ALLOWLIST): boolean`
  - `if (!envFlagEnabled(process.env.AUTO_DISTRIBUTION_ENABLED)) return false;`
  - `if (allowlist.size === 0) return true;`  // identical to today's behaviour
  - normalize the org id; `return orgId ? allowlist.has(orgId) : false;`  // fail closed

Then in `maybePrepareAvailableListing` replace the bare
`envFlagEnabled(process.env.AUTO_DISTRIBUTION_ENABLED)` read with
`autoDistributionEnabledForOrg(org.id)`. Leave `AUTO_LISTING_COPY_ENABLED`
untouched.

**Semantics must be a pure superset**, same discipline as S656: flag off means
false for everyone; flag on with an empty allowlist behaves identically to
`e173679`; an unresolved org id with a non-empty allowlist fails closed.

### Change 2 - stage connected + authorized instant channels

`autoDistributionChannels()` must additionally include any `api_automatic`
channel that is, for this org, `account_status='connected'` **and**
`automation_authorized=true`.

**Do NOT change `defaultSelected` in `lib/distribution-publish.ts:382.`**
That field is also read by `launch-run-panel.tsx:361` and `:364` to decide which
channels are pre-ticked versus offered unticked. Changing it would silently
change the panel too. Union the extra keys in at the `autoDistributionChannels`
layer instead.

- `autoDistributionChannels` becomes async (or takes the account rows as an
  argument - your call, but keep the call site readable) and reads
  `distribution_channel_accounts` for the org: `channel, account_status,
  automation_authorized`.
- Include a channel key when: the `DISTRIBUTION_CHANNELS` entry has
  `mode === "api_automatic"`, `account_status === "connected"`, and
  `automation_authorized === true`.
- **Instagram additionally requires `igChannelEnabledForOrg(org.id)`.** Do not
  bypass the S656 gate.
- Union with the existing `defaultSelected` keys, dedup, preserve the existing
  `PUBLISH_CHANNEL_KEYS` ordering.

No other behaviour changes. Do not touch `selectChannelPublishAutofireItems`,
`postInstagramNow`, `postFacebookPageNow`, `publishProperty`'s status guard, or
the `PUBLISH_SIMPLE_DEFAULT_ENABLED` branch.

## Why this is sufficient (already verified against `e173679`, do not re-derive)

Once `instagram` is in the `channels` array handed to
`stageDistributionRunForProperty`:

- `contextForChannel` sets `channelAccountStatus` from `accountStatusByChannel`
  (`actions.ts:2100`), so with a connected account
  `preparePublishChannel("instagram", ...)` returns
  `status: "needs_operator"` (`lib/distribution-publish.ts:507`).
- `"needs_operator"` is **not** in `NON_AUTOFIRE_STATUSES`
  (`lib/channel-publish-autofire.ts:25` = blocked, live, skipped, submitted,
  submitting), so the item survives the filter.
- `publishModeForDistributionChannel` returns `"automatic"` for `api_automatic`
  (`lib/distribution-publish.ts:632`), satisfying the
  `item.mode !== "automatic"` guard.
- The account is connected and authorized, satisfying the last guard.

So `publishAuthorizedInstantChannelsAfterPageLive` will select the item and call
`postInstagramNow`.

## Acceptance criteria

Add `scripts/test-auto-distribution-org-allowlist.ts` in the style of the
existing `scripts/test-*.ts` files, covering:

1. `AUTO_DISTRIBUTION_ENABLED` unset or not `"true"` -> `autoDistributionEnabledForOrg` false for every org, including an org in the allowlist.
2. Flag on + empty allowlist -> true for any org (identical to `e173679`).
3. Flag on + non-empty allowlist -> true only for a listed org; false for an unlisted org, for `null`, and for a malformed non-UUID id.
4. Allowlist parsing tolerates whitespace, mixed case, empty entries, trailing commas.
5. `autoDistributionChannels` with no connected accounts returns exactly the old `defaultSelected` set (`facebook`, `kijiji`, plus `network_feed` when `NETWORK_FEED_TOKEN` is set). **This is the no-regression case.**
6. With instagram connected + authorized and `igChannelEnabledForOrg` true -> the returned set contains `instagram`.
7. With instagram connected but `automation_authorized=false` -> `instagram` is **absent**.
8. With instagram connected + authorized but `igChannelEnabledForOrg` false -> `instagram` is **absent**.
9. Same three cases for `facebook_feed`, which has no IG gate.
10. A concierge or copilot channel that is connected and authorized (e.g. `zumper`, which is `automation_authorized=true` on Growth Test today) is **never** added - the `api_automatic` mode check must exclude it.

Criterion 10 matters: Growth Test currently has `rentals_ca`, `rentfaster`,
`viewit` and `zumper` sitting at `automation_authorized=true` with
`account_status='needs_setup'`. A naive "authorized" check would sweep them in.

Also confirm `npm run build` passes and report `git diff --stat main...HEAD`.

## Deploy notes for the operator (not Codex's job)

After merge, two NON-Sensitive Vercel env vars, then a redeploy, because Vercel
bakes env at build time:

- `AUTO_DISTRIBUTION_ENABLED=true`
- `AUTO_DISTRIBUTION_ORG_ALLOWLIST=8ea1da48-0cd2-45a4-bfba-023b31a67884`

That is Growth Test only. Agile `921f7c08-98af-428f-a238-36f4a781b0de` must
**not** be in the allowlist.
