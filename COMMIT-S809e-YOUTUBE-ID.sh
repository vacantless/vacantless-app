#!/bin/bash
# S809e: the repairs page links the new YouTube upload.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit
node scripts/run-all-tests.mjs
cat > /tmp/s809e-msg.txt <<'MSG'
S809e: the repairs page links the new YouTube upload

lib/friction-pages.ts repairs-and-emergencies: youtube pLcpfH77yqQ (the
57 s cut with texted repairs, uploaded 2026-11-17), replacing jEIfxcyiOU4.
How-to 4's new upload is 3OEjdV1VEMU (the app holds no how-to YouTube ids).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqw2x3R4yHt5egsYRV
MSG
git add lib/friction-pages.ts COMMIT-S809e-YOUTUBE-ID.sh
git commit -F /tmp/s809e-msg.txt
git push origin main || git push origin main
echo "== done"; git log --oneline -1
