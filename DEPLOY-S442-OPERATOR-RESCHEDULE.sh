#!/usr/bin/env bash
# S442 - Operator reschedule for an upcoming viewing.
# Move a still-open viewing to a new time, re-arm reminders/nudges, reset any
# prior confirmation, re-notify the renter (new-time email + surviving cancel link)
# and the assigned agent (new leasing.showing_rescheduled event).
# NO migration: reuses existing showings columns (reminder_*, feedback_request_sent_at,
# outcome_nudge_sent_at, confirmation_nudge_sent_at, confirmed_at/by, cancel_token).
# Gate was green: tsc clean, eslint clean, test-booking 52/0 (12 new reschedule
# datetime-local<->UTC cases), test-notifications 91/0, test-showing-agents 83/0,
# test-leads-notify 20/0. Live schema QA on North Star (b733a191): seeded an OPEN
# showing with every "already sent" stamp + a confirmation, replayed the guarded
# reschedule UPDATE -> time moved, all stamps reset, confirmation cleared, outcome
# preserved; a cancelled row was correctly immune to the guard; seeds torn down clean.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

# Safety: refuse to run from the wrong repo.
git rev-parse --is-inside-work-tree >/dev/null

git add \
  lib/booking.ts \
  lib/email.ts \
  lib/notifications.ts \
  app/dashboard/showings/actions.ts \
  app/dashboard/showings/page.tsx \
  app/dashboard/showings/reschedule-control.tsx \
  scripts/test-booking.ts

git commit -m "S442: operator reschedule for upcoming viewings (move time + re-notify + reset confirmation)"
git push

echo
echo "Pushed. Now VERIFY the Vercel deploy for this SHA appears (KI677):"
git rev-parse --short HEAD
