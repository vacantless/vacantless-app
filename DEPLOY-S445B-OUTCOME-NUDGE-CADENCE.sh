#!/usr/bin/env bash
# S445 slice 2 - bounded escalation + agent targeting for the post-showing outcome
# nudge, plus a per-org "how often" control.
#
# The one-shot outcome nudge (0097/S392) was too weak (one ignorable email = the
# 1-in-100-outcomes-recorded problem). This turns it into a BOUNDED follow-up that
# STOPS the instant the outcome is recorded, and points it at the person who knows.
#
# WHAT CHANGES
#  - Nudge TARGET: the assigned agent (email + one-tap on their /agent page) when
#    the viewing is assigned and the agent has an email; else the operator + the
#    /showing outcome page (unchanged fallback).
#  - CADENCE: up to organizations.outcome_nudge_max nudges (1 = just once, 3 =
#    follow up until answered), spaced by OUTCOME_NUDGE_OFFSETS_MS (fresh /
#    next-morning / final), still inside the 7d backlog bound. Recording the
#    outcome makes every future step false -> the series quits on answer.
#  - CONTROL: Settings -> Notifications, the "Post-showing outcome reminder" card
#    now has a "How often to remind" select (Just once / Follow up until answered).
#    "Off" stays the existing On switch (per-org event toggle). Account-level policy
#    stays behind login+manage_settings on purpose; per-viewing control (recording
#    the outcome) is one tap in the agent's email.
#
# Migration 0121 (showings.outcome_nudge_count + organizations.outcome_nudge_max,
# CHECK 1..3, default 3) is ALREADY APPLIED on prod (ref nvhvdyxpyogvadpjlvij); all
# 9 orgs default to follow-up but the event is DARK (opt-in) so nothing fires.
#
# Gate green: tsc clean, eslint clean, test-outcome-nudge 24 -> 36/0 (bounded-step
# gating, per-org cap once vs follow-up, stop-on-answer, backlog bound), reminders
# 13/0, outcome-nudge-send 10/0. The pure decision (outcomeNudgeStepDue) is fully
# unit-tested; the cron ships DARK, so the recommended post-deploy check is a
# dry-run (below) rather than a live send.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git rev-parse --is-inside-work-tree >/dev/null

git add \
  supabase/migrations/0121_outcome_nudge_cadence.sql \
  lib/reminders.ts \
  lib/org.ts \
  app/api/cron/showing-outcome-nudge/route.ts \
  app/dashboard/settings/notifications/page.tsx \
  app/dashboard/settings/notifications/actions.ts \
  scripts/test-outcome-nudge.ts \
  DEPLOY-S445B-OUTCOME-NUDGE-CADENCE.sh \
  codex-handoffs/CODEX-QA-HANDOFF-S445B-OUTCOME-NUDGE-CADENCE.md

git commit -m "S445b: bounded outcome-nudge escalation + agent targeting + per-org cadence control"
git push

echo
echo "Pushed. Migration 0121 already applied. Verify the Vercel deploy for this SHA"
echo "appears (KI677). Then, to prove the sweep end to end WITHOUT sending, run a"
echo "dry-run against North Star (it sends nothing):"
echo "  GET /api/cron/showing-outcome-nudge?dry=1&org=b733a191-30fd-47fe-bd21-731404148026&secret=\$CRON_SECRET"
echo "(or the GitHub Actions 'Run workflow' path, WORKFLOW 119). It returns the"
echo "'to: agent|operator' + 'nudge_step' per row without stamping or emailing."
git rev-parse --short HEAD
