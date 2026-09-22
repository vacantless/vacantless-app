#!/bin/bash
# S697d: "Get my address" re-renders the card. COMMIT ONLY, never pushes.
set -e
cd "$(dirname "$0")"
pick_bin() { if [ -x "./node_modules/.bin/$1" ]; then echo "./node_modules/.bin/$1"; else echo "npx $1"; fi; }
TSC=$(pick_bin tsc)
echo "== tsc =="; $TSC --noEmit
git add app/dashboard/link-portals/actions.ts COMMIT-S697d-GET-MY-ADDRESS-REFRESH.sh
git commit -F- <<'COMMITMSG'
S697d: "Get my address" shows the address without a reload

Seen live on the Growth Test org: the button created the address, but the
card kept showing the button until a manual reload. The action redirected
to the same page with only a #inquiries hash, which the router treats as
an in-page jump. It now adds ?address=ready so the page re-renders.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01T5vNLe7h1rxLs3UMLJ7tNT
COMMITMSG
echo "COMMITTED. Not pushed."; GIT_OPTIONAL_LOCKS=0 git log --oneline -1
