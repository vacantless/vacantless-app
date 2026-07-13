#!/usr/bin/env bash
# S481d - track migration 0143 in the repo (ledger completeness). NO code change.
# 0143 grants the N4 vault-filing source value 'in_app_generated' past the
# documents_source_check allowlist (0076); WITHOUT it fileN4ToVault's documents
# insert failed the CHECK and filed ZERO documents (caught in live North Star QA).
# ALREADY APPLIED TO PROD via Supabase MCP (2026-07-13) - this only commits the
# .sql so a rebuild / fresh environment / the migration sequence stays correct.
# Filing re-verified LIVE after the grant: notice->filed, filed_document_id set,
# exactly ONE documents row ("Form N4 - 18 Shorncliffe Avenue ...", 783KB).
set -euo pipefail
cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
git rev-parse --is-inside-work-tree >/dev/null
node_modules/.bin/tsx scripts/test-n4.ts   # expect 83/0 (sanity)
git add \
  supabase/migrations/0143_documents_source_in_app_generated.sql \
  DEPLOY-S481d-TRACK-MIG-0143.sh
git commit -m "S481d: track migration 0143 (documents.source allow 'in_app_generated' for N4 vault filing; applied to prod). No code change; filing verified live in North Star QA (notice->filed, one doc)."
git push
echo
echo "Pushed. 0142 + 0143 already on prod. Verify Vercel READY (KI677)."
git rev-parse --short HEAD
