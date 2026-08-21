# CODEX FIX — Scope the S610 entitlement surfaces (do not leak owner toggles)

**Base = current working tree (the S610 entitlements change, uncommitted). Additive/subtractive edits only, no migration. Do not `git push` — Noam reviews and pushes.**

Warm-verify of the S610 entitlements lane found one regression + one honesty issue. This fixes both. The generalized resolver, the admin action, and the default-preserving `planDefaultForFeature` are CORRECT — keep them. The problem is purely which feature LIST each UI surface shows.

## THE PROBLEM (confirm before editing)
- `SETTINGS_ORG_FEATURES` in `lib/feature-entitlements.ts` was expanded from the original 4 keys to all 18 (special + every `PLAN_FEATURES`).
- That constant is read by the OWNER self-serve settings page `app/dashboard/settings/page.tsx:406` (`SETTINGS_ORG_FEATURES.map(...)`), which renders each entry as an owner-editable On/Off toggle wired to `updateOrganizationFeatureFlag`. So the change surfaces 18 owner-flippable toggles — including paid tiers (accounting, rent_collection, tax_export, market_rent) — on every operator's settings page. That violates the tier-gating rule (paid features show locked + upsell, never a free self-serve toggle).
- Separately: the per-org override only actually gates the features whose code reads `isFeatureEnabledForOrg` — today that is `incident_intake`, `incident_dispatch`, `ai_reply`, `landlord_campaign`. The other 14 `PLAN_FEATURES` are gated by `hasEntitlement` directly and IGNORE the override, so showing them in the admin matrix is misleading.

## THE FIX
1. **Restore `SETTINGS_ORG_FEATURES` to exactly the pre-S610 curated 4**, in this order: `ai_reply`, `landlord_campaign`, `incident_intake`, `incident_dispatch` — with their original labels/descriptions. This is the list BOTH the owner settings page and the admin cross-org matrix show. (These 4 are exactly the features the override functionally controls today, so both surfaces stay honest.) You may keep internal helper maps, but the EXPORTED `SETTINGS_ORG_FEATURES` array must be those 4.
2. **Revert `envMasterForFeature` to the pre-S610 mapping** (only `ai_reply → AI_REPLY_ENABLED`, `landlord_campaign → LANDLORD_CAMPAIGN_ENABLED`; everything else `null`). The `lease_ocr`/`listing_ai_import`/`market_rent` env-master branches are unreachable now (those keys are in no UI list and no consumer routes them through `isFeatureEnabledForOrg`) and implying they're override-gated is misleading. Drop the `FeatureEnvMaster` additions accordingly.
3. **KEEP** the generalized `ORG_FEATURE_KEYS` (all 18) — it is used only by `isOrgFeatureKey` to validate the `feature_key` in `setOrgFeatureFlagAsAdmin`, which is fine. **KEEP** `planDefaultForFeature`'s `default → hasEntitlement(plan, key)` branch (correct + default-preserving). **KEEP** the admin action `setOrgFeatureFlagAsAdmin` and the admin matrix in `app/dashboard/admin/page.tsx` unchanged (the matrix reads `SETTINGS_ORG_FEATURES`, so it will now correctly render the 4 controllable features across orgs).
4. Update `scripts/test-feature-entitlements-generalized.ts` to match: it must still assert the default-preserving invariant for EVERY `ORG_FEATURE_KEYS` key (no override ⇒ `planDefaultForFeature` equals `hasEntitlement(plan, key)` for plan features, and equals the special-case default for `ai_reply`/`landlord_campaign`), but drop any assertion that expected 18 entries in `SETTINGS_ORG_FEATURES` (it is 4).

## VERIFY
- `app/dashboard/settings/page.tsx` renders exactly the original 4 owner toggles (diff the rendered feature list against prod `046b251` — it must match).
- The admin matrix renders those same 4 features as columns across orgs, posting to `setOrgFeatureFlagAsAdmin`.
- Default-preserving invariant holds for all 18 keys via `planDefaultForFeature` (test).
- `npx tsx scripts/test-feature-entitlements-generalized.ts` and `scripts/test-feature-entitlements.ts` pass; `npx tsc --noEmit`; `npm run lint` (only the known `<img>` warning); esbuild-parse the edited TSX. Do NOT git push.

## OUT OF SCOPE
Do NOT rewire the other 14 features' gates from `hasEntitlement` to `isFeatureEnabledForOrg` — that is a separate deliberate lane. This fix only corrects which features the two UIs expose.
