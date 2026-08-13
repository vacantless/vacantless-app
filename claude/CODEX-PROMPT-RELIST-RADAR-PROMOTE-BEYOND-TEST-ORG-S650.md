# CODEX PROMPT - Relist Radar: promote beyond the test-org hard-scope (S650)

Repo: `vacantless-app`. Branch from: current prod `main`.
Flags unchanged and still the global on/off levers: `RELIST_RADAR_CLOCK_ENABLED`, `RELIST_RADAR_EMAIL_ENABLED`, `RELIST_RADAR_EXECUTE_FREE_ENABLED`. Ship dark, default off.
Design of record: `claude/DESIGN-RELIST-RADAR-EXPIRY-AUTOREFRESH-S642.md`.

Goal: replace the single hard-coded `RELIST_RADAR_TEST_ORG_ID` scope with an optional org allowlist that defaults to all orgs when unset, applied uniformly across Relist Radar clock stamping, candidate detection, notify/veto email, and free execution. Keep every existing safety invariant. No behavior change while the flags are off.

Critical context verified from prod DB on 2026-08-13:
- Only the test org `8ea1da48` currently has `external_posted_at` / `external_expires_at` populated.
- The clock-stamp path must de-scope too; if stamping stays test-scoped, real orgs never accrue expiry clocks.
- No backfill of existing rows is in scope. Existing clockless live ads are not detected until they get a clock from a fresh post/re-mark or a separate manual backfill.

Acceptance highlights:
- `RELIST_RADAR_ORG_ALLOWLIST` is comma-separated UUIDs. Empty or unset means all orgs.
- A non-empty allowlist touches only those orgs.
- Clock stamping stays gated by `RELIST_RADAR_CLOCK_ENABLED` and known channel TTLs.
- Detection, email, and free execution keep existing paid/leased/cycle/idempotency/veto/CAS/backup-first/no-credit invariants.
- PR notes must call out the forward-only clock and recommended rollout: allowlist Agile first, enable clock and email, then execute-free after proof.
