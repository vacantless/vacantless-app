#!/bin/bash
# S809f: the "is this still available?" page links its re-uploaded YouTube video.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit
node scripts/run-all-tests.mjs
cat > /tmp/s809f-msg.txt <<'MSG'
S809f: the "is this still available?" page links its re-upload

The YouTube copy (KLXuBpDyggw) was deleted by mistake on 2026-11-17: after
the old how-to 4 was deleted the Studio rows shifted and the next "Delete
forever" box opened on this video instead of the old repairs one. The same
file (public/videos/fix-is-this-still-available.mp4, 38 s) is re-uploaded
as PJ3o8MvH6Os, Public, same title, description rebuilt from the page.

Only lib/friction-pages.ts is committed here; lib/ask-pages.ts and
scripts/test-ask-pages.ts carry someone else's uncommitted edits and are
left alone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqw2x3R4yHt5egsYRV
MSG
git add lib/friction-pages.ts COMMIT-S809f-YOUTUBE-RELINK.sh
git commit -F /tmp/s809f-msg.txt
git push origin main || git push origin main
echo "== done"; git log --oneline -1
