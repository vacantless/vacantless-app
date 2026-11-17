#!/bin/bash
# S812b: public copy names the Quick replies answers (S812a is live).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit
node scripts/run-all-tests.mjs
cat > /tmp/s812b-msg.txt <<'MSG'
S812b: public copy names the Quick replies answers

S812a (c6b4495) is live and checked on Agile: every "They asked about"
button on the four available rentals reads from the record. The public
copy now says so (WORKFLOW 348: copy follows the feature).

- app/page.tsx: the homepage "little things" Quick replies line names the
  ready answers on pets, parking and utilities.
- lib/friction-pages.ts: the "is this still available?" page gains one how
  line, "One tap answers pets, parking and utilities questions."

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqVR5owGBGyB57WeXJ
MSG
git add app/page.tsx lib/friction-pages.ts COMMIT-S812b-QUICK-REPLY-ANSWERS-COPY.sh
git commit -F /tmp/s812b-msg.txt
git push origin main || git push origin main
echo "== done"; git log --oneline -1
