# CODEX PROMPT - IG channel org allowlist (S656)

**Repo:** `vacantless-app`
**Base:** `main` at `ede4486`
**Branch to create:** `codex/s656-ig-channel-org-allowlist`
**Ship state:** commit on the branch, DARK. Do NOT push. Do NOT flip any env var.

---

## WHY (read this before touching code)

`IG_CHANNEL_ENABLED` is today a single global boolean. The Instagram publish path is built
but has never run against the live Graph API: `instagram_basic` and `instagram_content_publish`
both sit at **0 API calls**, and the Meta App Review screencast needs a real IG post that does
not exist.

Exercising the publish path requires the gate on. But the gate is global, and turning it on
globally makes an Instagram entry appear in the property distribution rail
(`app/dashboard/properties/[id]/page.tsx:1399`) for every org where Facebook Page is enabled -
including real customers - for a channel Meta has not yet approved.

We do not want to suspend that protection on a judgment call. We want a mechanism that lets
exactly one disposable test org exercise the path while every other org stays exactly as it is
today.

The codebase already solved this exact problem once. `lib/relist-radar.ts:105-114` defines
`parseRelistRadarOrgAllowlist` + `RELIST_RADAR_ORG_ALLOWLIST`, used by S650 to promote Relist
Radar to all orgs while keeping a test-org pin available. **Mirror that pattern.** Do not
invent a new one.

### Verified starting facts (do not re-derive, do not contradict)

These were verified 2026-08-15 against the live database and the repo at `ede4486`:

- There are **zero** `instagram` rows in `distribution_channel_accounts`, platform-wide.
- There is **exactly one** `facebook_feed` row: org `Growth Test`
  `8ea1da48-0cd2-45a4-bfba-023b31a67884`, page_id `1237906646071726`, connected 2026-08-05,
  `automation_authorized = false`.
- The Agile org `921f7c08-98af-428f-a238-36f4a781b0de` has **no** `facebook_feed` row. Its
  Facebook presence is the manual Marketplace guided-posting rail, not the Graph API.
- `IG_CHANNEL_ENABLED` was **off** on 2026-08-05. Proof: `saveFacebookPageConnection`
  (`lib/facebook-page-oauth.ts:257`) returns early when the flag is off, which is why Growth
  Test's connect created no Instagram row.

---

## THE FIVE CALL SITES (all of them - there are no others)

`grep -rn "IG_CHANNEL_ENABLED" --include="*.ts" --include="*.tsx" app lib components` returns
exactly these:

| # | Site | What it gates | orgId available? |
|---|------|---------------|------------------|
| 1 | `lib/facebook-page-oauth.ts:62` (`igChannelEnabled()`) | the raw global reader | n/a |
| 2 | `lib/facebook-page-oauth.ts:68` (via `facebookPageScopes`) | whether OAuth requests `instagram_basic` + `instagram_content_publish` | no - callers must supply |
| 3 | `lib/facebook-page-oauth.ts:257` (`saveFacebookPageConnection`) | whether a connect creates an Instagram channel row | **yes** - `args.organizationId` |
| 4 | `app/dashboard/properties/distribution-actions.ts:769` and `:800` | **disconnect** teardown only, not publish | **yes** - local `orgId` |
| 5 | `app/dashboard/properties/[id]/page.tsx:1399` | Instagram entry in the distribution rail | **yes** - `propertyOrgId` |

Plus two consumers of the same env read:

| # | Site | What it gates | orgId available? |
|---|------|---------------|------------------|
| 6 | `app/dashboard/properties/actions.ts:1060` (`instagramEnabled`) | whether IG joins the publish autofire set (`lib/channel-publish-autofire.ts:58`) | **yes** - `orgId` in the same helper |
| 7 | `app/dashboard/properties/distribution-actions.ts` `postInstagramNow` (`!igChannelEnabled()` guard) | the one-tap manual publish | **NOT YET** - see the trap below |

---

## WHAT TO BUILD

### 1. `lib/facebook-page-oauth.ts` - the gate

Add, mirroring `parseRelistRadarOrgAllowlist`:

```ts
export function parseIgChannelOrgAllowlist(value: string | null | undefined): Set<string>
```

Comma-separated, trimmed, lowercased, empty entries dropped. Reuse or match the existing
normalizer's behaviour in `lib/relist-radar.ts`; do not hand-roll a looser one.

Then:

```ts
export function igChannelEnabledForOrg(
  organizationId: string | null | undefined,
  allowlist: ReadonlySet<string> = IG_CHANNEL_ORG_ALLOWLIST,
): boolean
```

Semantics, exactly:

- `igChannelEnabled() === false` -> **always false**. The global flag stays the master switch.
- flag on **and allowlist empty** -> **true for every org**. This preserves today's semantics
  as a pure superset, so setting only `IG_CHANNEL_ENABLED=true` behaves identically to before
  this change.
- flag on **and allowlist non-empty** -> true only if the normalized `organizationId` is in it.
- `organizationId` null, undefined or blank **and allowlist non-empty** -> **false (fail
  closed)**. Never treat an unresolvable org as allowed.

Keep `igChannelEnabled()` exported and unchanged - site 1 stays the raw global reader.

### 2. `facebookPageScopes` (site 2) and its three callers

`facebookPageScopes(opts?: { instagramEnabled?: boolean })` already takes an override. Leave the
signature alone. Update the three callers to pass an org-resolved value:

- `app/dashboard/facebook-connect/page.tsx:32`
- `app/api/integrations/facebook/callback/route.ts:247`
- `app/api/integrations/facebook/connect/route.ts:61`

Each already resolves an org for its own flow (state cookie, current org, or property lookup).
Use that. If a caller genuinely cannot resolve an org at that point, pass `false` and say so in
your report - do not silently fall through to the global default.

**Why this one matters most:** this is the only site that changes what Meta is asked for. An
org outside the allowlist must keep getting exactly `FACEBOOK_PAGE_BASE_SCOPES`, byte for byte.

### 3. Sites 3, 4, 5, 6

Mechanical: swap `process.env.IG_CHANNEL_ENABLED === "true"` / `igChannelEnabled()` for
`igChannelEnabledForOrg(<the orgId already in scope>)`. Sites 4 and 5 use `orgId` and
`propertyOrgId` respectively; site 6 has `orgId` in the same helper that builds the
`selectChannelPublishAutofireItems` input.

### 4. Site 7 - `postInstagramNow`, and the ordering trap

The current guard is near the top:

```ts
if (!facebookOAuthConfigured() || !igChannelEnabled()) {
  redirect("/dashboard/properties?ig=error&reason=disabled");
}
```

This runs **before** `orgId` is resolved (orgId comes from the run/item lookup ~40 lines later).
Do **not** move the org lookup above the guard - that would let an unauthenticated-ish path do
database work before the cheap gate.

Instead:

- **Keep** the existing top guard as-is, still using the global `igChannelEnabled()`. It is the
  cheap fail-fast and it must stay first.
- **Add a second guard** immediately after `orgId` is resolved and non-null (right where the
  existing `if (!propertyId || !orgId) redirect(...)` check sits), using
  `igChannelEnabledForOrg(orgId)`, redirecting to the same
  `?ig=error&reason=disabled` outcome via the existing `backTo(propertyId, ...)` helper so the
  operator lands back on the property.

Place it **before** the `publish_status: "submitting"` reservation write, so a blocked org never
reserves an item it cannot publish.

---

## HARD CONSTRAINTS

- **Do not flip, add, or edit any environment variable.** Not in Vercel, not in `.env*`.
  Documenting the new var name in a comment or README is fine.
- **Do not push.** Commit to the branch and stop.
- **Flag-off must stay a true no-op.** With `IG_CHANNEL_ENABLED` unset, the rendered DOM, the
  requested OAuth scopes, and the autofire selection must be byte-identical to `ede4486`.
- No em dashes in any code comment, string, or doc you write.
- No changes to `lib/instagram-graph.ts`. The publish implementation is not in scope.

---

## ACCEPTANCE CRITERIA

1. `npx tsc --noEmit` clean.
2. `npm run lint` clean.
3. `npm run build` succeeds.
4. Unit tests added and passing for `parseIgChannelOrgAllowlist` and `igChannelEnabledForOrg`,
   covering **all five** semantic rows in the table above, including the fail-closed
   null-org-with-non-empty-allowlist case.
5. A test (or a documented manual check) proving `facebookPageScopes` returns exactly
   `FACEBOOK_PAGE_BASE_SCOPES` for a non-allowlisted org while the flag is on.
6. `grep -rn "IG_CHANNEL_ENABLED" --include="*.ts" --include="*.tsx" app lib components`
   returns **only** `lib/facebook-page-oauth.ts` (the two gate functions). No other file reads
   the env var directly. Paste the grep output in your report.
7. **Prove the commit exists with `git diff main...codex/s656-ig-channel-org-allowlist --stat`
   and paste the real output.** `git status` and bare `git diff` are not acceptable proof - a
   prior session reported "committed" for loose working-tree state on a branch that pointed at
   main.
8. **Report the actual diff shape and explain it.** If it does not match what you expected,
   say so and explain why. Do **not** reshape the code to match a prediction. A predicted diff
   shape in an acceptance criterion can itself be wrong.

## REPORT BACK

- The `git diff main...<branch> --stat` output, verbatim.
- The grep output from criterion 6.
- For each of the 7 call sites: which expression you used to resolve `organizationId`, and for
  the three `facebookPageScopes` callers, whether resolution succeeded or you passed `false`.
- Anything you found that contradicts the "verified starting facts" section above.
