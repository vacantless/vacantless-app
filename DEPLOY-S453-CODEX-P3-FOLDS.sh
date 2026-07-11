#!/usr/bin/env bash
# S453 - Codex broader-pass P3 folds. CODE ONLY - no migration, no DB change,
# no production data touched. Scoped to exactly two files (the pre-existing
# unrelated working-tree changes are deliberately left OUT of this commit).
#
# Findings folded (from Codex 2026-07-10 website/app pass, no P1/P2 found):
#   P3a  app/about/page.tsx - the marketing header linked to stale /#workflow
#        and /#why anchors; the current homepage sections are #product, #rent,
#        #pricing. Re-pointed to /#product ("What you get") and /#rent ("Rent
#        collection"); /#pricing unchanged.
#   P3b  app/dashboard/people/page.tsx - the People list counted only in-app
#        lease_documents (via tenancy + signer) and omitted uploaded vault files
#        (0076 `documents`), so a person whose only docs are vault uploads read
#        "0 documents" while their detail page read the real count (e.g. Kevin /
#        10 Bellair = 4). Now also counts vault files via tenancy OR person_id,
#        exactly mirroring the detail page's `documents.length + vaultFiles.length`.
#
# Gate (run on device this session):
#   - ./node_modules/.bin/tsc --noEmit: clean (EXIT 0)
#   - ./node_modules/.bin/eslint app/about/page.tsx app/dashboard/people/page.tsx: clean (EXIT 0)
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
git rev-parse --is-inside-work-tree >/dev/null

git add \
  app/about/page.tsx \
  app/dashboard/people/page.tsx \
  DEPLOY-S453-CODEX-P3-FOLDS.sh

git commit -m "S453: fold Codex P3s - about-page anchors + People-list vault doc count"
git push

echo
echo "Pushed. No migration. Verify the Vercel deploy for this SHA is READY + aliased (KI677)."
git rev-parse --short HEAD
