#!/bin/bash
# S809d: how-to 4 re-shot on the one sites page; texted repairs spliced into the repairs video.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit
node scripts/run-all-tests.mjs
cat > /tmp/s809d-msg.txt <<'MSG'
S809d: how-to 4 and the repairs video match the app again

- public/videos/howto-4.mp4 (93 s): re-shot on the S806 one sites page,
  with step 2 "Get renter emails here"; the "On, Posting, or Needs you"
  caption is now "with what it needs from you, if anything" (S805 added
  "Your choice"). Take raw/howto-4-202611171338.webm, OCR scan clean.
- public/videos/fix-repairs-and-emergencies.mp4 (57 s): a 12 s beat for
  tenants texting a repair to the landlord's number (S808b), spliced
  before the end card; the rest of the video unchanged.
- lib/how-to-videos.ts entry 4 and lib/friction-pages.ts repairs (length
  and a "texts your number" line).
- YouTube copies (how-to 4, repairs) still show the older cut until
  replaced.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqw2x3R4yHt5egsYRV
MSG
git add public/videos/howto-4.mp4 public/videos/fix-repairs-and-emergencies.mp4 lib/how-to-videos.ts lib/friction-pages.ts COMMIT-S809d-VIDEOS.sh
git commit -F /tmp/s809d-msg.txt
git push origin main || git push origin main
echo "== done"; git log --oneline -1
