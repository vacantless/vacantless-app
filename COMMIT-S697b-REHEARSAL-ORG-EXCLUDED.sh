#!/bin/bash
# S697b: the dress-rehearsal org joins the non-production list. COMMIT ONLY, never pushes.
set -e
cd "$(dirname "$0")"
pick_bin() { if [ -x "./node_modules/.bin/$1" ]; then echo "./node_modules/.bin/$1"; else echo "npx $1"; fi; }
TSX=$(pick_bin tsx); TSC=$(pick_bin tsc)
echo "== tsc =="; $TSC --noEmit
echo "== provenness suite =="; $TSX scripts/test-channel-provenness.ts
for real in 921f7c08-98af-428f-a238-36f4a781b0de b2cb4eab-9a29-4972-8fca-564dc8ca6a61 9315e41e-1c03-43e3-9c8f-78563512f302; do
  if grep -q "\"$real\"" lib/channel-provenness.ts; then echo "ABORT: customer org $real is listed."; exit 1; fi
done
git add lib/channel-provenness.ts scripts/test-channel-provenness.ts COMMIT-S697b-REHEARSAL-ORG-EXCLUDED.sh
git commit -F- <<'COMMITMSG'
S697b: exclude the dress-rehearsal org from channel provenness

"Rehearsal Rentals S697" (695ebb66) was created through the public signup
to walk onboarding as a stranger. It pressed Post, so it holds a staged
Kijiji run item and briefly showed Rentals.ca and Zumper as connected.
Listed before any of that could count as a customer proving a channel.
Seven non-production orgs now; the test pins the count.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01T5vNLe7h1rxLs3UMLJ7tNT
COMMITMSG
echo "COMMITTED. Not pushed."; GIT_OPTIONAL_LOCKS=0 git log --oneline -1
