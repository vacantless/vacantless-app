#!/usr/bin/env bash
# S442b - fold Codex review of S442 operator reschedule (range e77089f..2d96982).
# P2: notify the assigned agent off the POST-update assignment (the guarded UPDATE's
#     RETURNING value), not the pre-read, so a concurrent reassign/unassign can't
#     email a stale agent. P3: validate the optional seconds group in
#     parseLocalInputToUtc so a forged "...:99" is rejected (dropped to :00 when valid).
# No migration. Gate green: tsc clean, eslint clean, test-booking 54/0.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git rev-parse --is-inside-work-tree >/dev/null

git add \
  app/dashboard/showings/actions.ts \
  lib/booking.ts \
  scripts/test-booking.ts

git commit -m "S442b Codex fold: notify post-update assigned agent on reschedule (P2), reject out-of-range seconds in parseLocalInputToUtc (P3)"
git push

echo
echo "Pushed. Now VERIFY the Vercel deploy for this SHA appears (KI677):"
git rev-parse --short HEAD
