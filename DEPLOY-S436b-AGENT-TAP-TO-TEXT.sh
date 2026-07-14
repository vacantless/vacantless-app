#!/usr/bin/env bash
# S436b (Slice 1.5) - tap-to-text/call the assigned agent's phone on each showing
# row. Single file, view-layer only, no migration, no notification change.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git add app/dashboard/showings/page.tsx codex-handoffs/S436-SHOWING-AGENTS-ROUTING.md

git commit -m "S436b: tap-to-text/call the assigned agent on each showing row (Slice 1.5, view-layer)"

git push origin main

echo "Pushed. Watch Vercel for the build; re-trigger with an empty commit if it doesn't auto-deploy."
