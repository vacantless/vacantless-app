#!/bin/bash
# S832b: every account gets one rental robot-posted free (migration 0322 already applied).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q 'otherRobotRentals' lib/billing.ts || { echo "STOP: S832b edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-billing.ts
node scripts/run-all-tests.mjs
git add lib/billing.ts lib/robot-posting-access.ts supabase/migrations/0322_every_account_one_robot_rental.sql scripts/test-billing.ts app/page.tsx app/compare/showinghero/page.tsx COMMIT-S832b-ONE-ROBOT-RENTAL-EVERY-PLAN.sh
git diff --cached --name-only
git commit -m "S832b: one robot-posted rental free on every plan

A Free account's one rental was posted to Kijiji, Rentals.ca and Zumper by
the robot, but a paid plan without the Posting add-on got none, so upgrading
took posting away. Now every account gets one free robot rental: the one
that already has live ads on those sites, or the one being posted when none
does. Posting covers every other rental. Migration 0322 (applied) is the SQL
twin for the worker claim. Copy on the homepage, plan cards and comparison
page says every plan.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGoZLAxBr3cq3Dgcj6r"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
