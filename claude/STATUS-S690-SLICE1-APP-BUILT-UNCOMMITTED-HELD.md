# STATUS S690: Post Everywhere Slice 1, app read model BUILT on the Mac, uncommitted, held until the Meta verdict

Date: 2026-09-07 (Session 690). Builder: Cowork. Spec: `claude/SPEC-S688-POST-EVERYWHERE-SLICE1-BUILD-READY.md` section 3. Predecessor: `claude/STATUS-S689-SLICE1-WORKER-BUILT-0225-HELD-NO-QA-PROJECT.md`.

## What exists now

All three halves of Slice 1 are written. None is live.

| Half | State | Where |
|---|---|---|
| Migration 0225 | on disk, NOT applied, NOT committed (prod migration, held until Meta) | `supabase/migrations/0225_distribution_channel_session_status.sql` |
| Worker `session:check` | built + audited (S689), 12 paths uncommitted on the Mac until Noam runs `PUSH-S689-WORKER-SESSION-CHECK.sh` | `vacantless-worker` |
| App read model (this session) | built + audited, 18 paths uncommitted on the Mac, never pushed (a push deploys) | `vacantless-app` |

Verification on the Mac, 2026-09-07 ~17:40Z: `npx tsc --noEmit` exit 0; `eslint` on every touched path exit 0; test scripts green: `test-session-status-readmodel` 128/0 (new), `test-no-client-secret-imports` 63 client modules / 0 offenders (new), `test-stage1-link-portals` 57/0, `test-stage1-connect-copy-truth` 22/0 (unchanged, still green: Slice 1 never logs in for the user), `test-distribution-channels` 301/0, `test-channel-tile-status-readmodel` 57/0, `test-stage3-send-live` 25/0, `test-channel-connect-chip` 54/0. `next build` cannot run in the bridge VM (darwin native deps); Vercel is the build gate, after the verdict.

## The 18 app paths

New (8): `lib/distribution-session-status.ts` (server only: `requestSessionCheck`, `probeOauthSessions`, `classifyGraphMe`, body validation, 60 s per-org-per-channel throttle) · `app/api/distribution/session-check/route.ts` (POST, 404 with the flag off, 403 without `manage_properties`, org from `getCurrentOrg`) · `app/dashboard/link-portals/view-model.ts` (server: every tile string resolved through next-intl, en + fr) · `app/dashboard/link-portals/actions.ts` (`readLinkPortalTiles` poll target, `setKijijiTier` jsonb merge) · `app/dashboard/link-portals/connect-tiles.tsx` (client: renders the view model; with the flag on POSTs the stale channels once, polls every 5 s up to 90 s; with the flag off never fetches or writes) · `scripts/test-session-status-readmodel.ts` · `scripts/test-no-client-secret-imports.ts` · (0225 from S689 sits beside these as untracked).

Edited (10): `lib/distribution-channels.ts` (8 tile states, `ChannelTileSession`, `CHANNEL_COST_CENTS`, `CHANNEL_FREE_CAP`, `channelCostCap` + `channelCostCapLine`, `spendReadyForAccount`, `channelTileStatus(key, account, session, now)`) · `lib/distribution-channel-tile-statuses.ts` (session rows, `channelTileLine` four new cases) · `lib/stage1-link-portals.ts` (groups, copy, `canRenderStage1Connect` for `dead_session`, reason keys) · `lib/stage3-send-live.ts` · `app/dashboard/properties/actions.ts` (`listChannelTileStatuses` widened; view read only with the flag on) · `app/dashboard/link-portals/page.tsx` · `messages/en.json` + `messages/fr.json` (stage1 additions, additive only) · `package.json` (two `test:` scripts) · `scripts/test-distribution-channels.ts`, `scripts/test-stage1-link-portals.ts`, `scripts/test-stage3-send-live.ts`.

## Two deliberate deviations from the spec (Cowork's call, both in the tile's favour)

1. **`session === undefined` means "session model off", not "checking".** The spec said legacy callers get `checking`. That would have put every connected Agile channel into `checking` on `/dashboard/send-live` (whose sendable set is `state === "linked"`) with nobody ever probing Agile. Now the read path passes session rows only when `DISTRIBUTION_WIZARD_ENABLED === "1"` and the 0225 view read succeeds; otherwise the resolver runs steps 1 to 5, 8, 9 from the account row alone. Flag off = no writes, no checking, no cap, no "Not checked yet", no Kijiji tier question. `session === null` (model on, no row) reads `dead_session` with code `no_session`: nothing can probe a row that does not exist, so "Checking" would have spun forever.
2. **Stage 3 sendable = `linked` or `checking`.** Before this slice a connected + authorized channel was sendable whether or not its session was alive (the blast already turns a dead session into `needs_login` on the run item). `dead_session`, `cap_reached` and `connected_needs_authorization` do drop out; with the flag on, a connected channel with no session row now also drops out (it could never have posted).

Reviewer defect 1 (P2, fixed): a reconnect never cleared a dead verdict, because `writeChannelSession` bumps `last_validated_at` but leaves `alive=false`. The resolver now treats a dead verdict as current only when `last_checked_at >= last_validated_at`; a re-warmed or reconnected row falls through to `checking` and asks for a re-probe. `last_validated_at` was added to the view select (it is already in the 0225 grant).

## Flag scope, stated plainly

`DISTRIBUTION_WIZARD_ENABLED` is a Vercel env var, one value for every org. If it is `1` in prod, the Agile org is in session-aware mode too: its connected account_login channels read `checking` until the Mac autopilot probes them (decision 3: the Mac owns the probes) and are still sendable in Stage 3; a connected channel with no session row reads Reconnect. Check the Vercel value before the deploy and decide whether Agile's three sessions get a probe on day one.

## Ship order (unchanged, section 4 of the spec)

1. Meta verdict lands (by 2026-09-22).
2. Noam's go, then `apply_migration` 0225 on `nvhvdyxpyogvadpjlvij`; read the objects back; authenticated `select encrypted_state` must fail.
3. Worker already pushed by then (`PUSH-S689-WORKER-SESSION-CHECK.sh`); first live probe on Growth Test from the Mac, headed; pin the label selectors.
4. App: Noam commits the 18 paths from his terminal (`COMMIT-S690-APP-SLICE1-NO-PUSH.sh` commits only) and pushes when the deploy is wanted. Gate: Growth Test tiles show label + cap line within 90 s; sign out of one QA portal, the tile flips to Reconnect with "signed out" within one worker tick.
5. Agile with the flag off: open `/dashboard/link-portals`, then read `check_requested_at` on its three session rows: still null.

## Bridge finding worth keeping

`tsx` "dies" in the bridge VM only because `node_modules/@esbuild` holds the darwin-arm64 binary. `npm i @esbuild/linux-arm64@<esbuild version>` into `$HOME/esb` (outside the mount) and `ESBUILD_BINARY_PATH=$HOME/esb/node_modules/@esbuild/linux-arm64/bin/esbuild` make every `npx tsx scripts/test-*.ts` run there in under a second; `tsc --noEmit` and `eslint` run as-is. `next lint`/`next build` still cannot (parcel watcher, sharp).
