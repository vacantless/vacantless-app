#!/usr/bin/env bash
# S445 - Agent one-tap outcome capture on the /agent/[token] page.
# The covering agent already opens their shared-calendar link to Confirm a viewing
# BEFORE it happens (S440). This adds "Renter showed / No-show" for a viewing whose
# time has PASSED, so the outcome is captured at the person who was on-site in one
# tap - closing the loop the operator-targeted nudge (S392) couldn't, because the
# operator often doesn't know whether the renter showed and the agent does.
#
# Migration 0120 (record_showing_outcome_from_agent_token) is ALREADY APPLIED on
# prod (ref nvhvdyxpyogvadpjlvij). It is a SECURITY DEFINER RPC mirroring
# confirm_showing_from_token (0118): keyed on agent_token + showing_id, records
# ONLY a viewing assigned to that agent, accepts only 'attended' / 'no_show',
# replays 0098's attended->'showed' lead advance + a 'Viewing marked X by <agent>.'
# timeline note, and is a no-op success on an already-closed viewing. Anon-granted;
# a wrong token records nothing. This script ships only the app code that calls it.
#
# NO new pure lib logic (the RPC is the source of truth); the tokenized page is
# verified live, not in the unit harness.
#
# Gate green: tsc clean, eslint clean. Live schema-QA on North Star (b733a191):
# seeded AgentA + AgentB + 3 past viewings; the RPC returned bad_outcome (cancelled),
# not_found (wrong token), not_found (AgentB on AgentA's viewing), ok/attended,
# ok/no_show, and already:true (idempotent 2nd tap). Side effects verified:
# attended -> lead 'showed' + note; no_show -> lead unchanged + note; the untouched
# viewing stayed 'scheduled'. Seed torn down clean (roster 0, baseline 4 showings).
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

# Safety: refuse to run from the wrong repo.
git rev-parse --is-inside-work-tree >/dev/null

git add \
  supabase/migrations/0120_record_showing_outcome_from_agent_token.sql \
  app/agent/[token]/actions.ts \
  app/agent/[token]/page.tsx

git commit -m "S445: agent one-tap outcome capture on /agent/[token] (Renter showed / No-show; RPC 0120)"
git push

echo
echo "Pushed. Migration 0120 already applied on prod. Now VERIFY the Vercel deploy"
echo "for this SHA appears (KI677); if it doesn't build within a minute, re-trigger:"
echo "  git commit --allow-empty -m 'S445 redeploy' && git push"
git rev-parse --short HEAD
