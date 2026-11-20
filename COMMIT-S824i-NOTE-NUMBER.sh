#!/bin/bash
# S824i: in emails, the arrival number sits right after the arrival note.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
npx tsc --noEmit -p .
npx tsx scripts/test-s824f-arrival-note.ts
npx tsx scripts/test-booking-confirmation-copy.ts
node scripts/run-all-tests.mjs
git add lib/email.ts scripts/test-s824f-arrival-note.ts COMMIT-S824i-NOTE-NUMBER.sh
git commit -m "S824i: the arrival number right after the arrival note

Pillette's note says text or call when you're at the front door. In the
email the number came three lines lower, under the map. Now the line reads:
When you arrive: Text or call when you're at the front door... Call or
text 226-778-0014. The number is still set once, as the arrival phone.
The texts already put it right after the note.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGq4W8hFu15eRRP3WoB"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
