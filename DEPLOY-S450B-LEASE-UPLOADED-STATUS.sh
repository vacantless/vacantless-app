#!/usr/bin/env bash
# S450b - Codex dogfood #6 (handoff-confidence). CODE ONLY - no migration, no DB
# change, no production data touched.
#
# The tenancy "Lease document" card derived its status ONLY from lease_documents
# (in-app clause-wizard / executed-lease rows), so a tenancy where the operator
# UPLOADED a signed lease PDF into the document vault (doc_type="lease") with no
# lease_documents row read "Not started" - even with 4 signed docs on file (10
# Bellair #1604: 0 lease_documents, 4 vault docs incl. a lease). Now, when there
# is no in-app lease doc but a vault doc of type "lease" exists, the card reads
# "Uploaded" and the section shows as done, so the handoff reflects reality. An
# "Uploaded" lease also no longer pulls focus in pickDefaultOpenSection (a lease
# is on file). Files: lib/tenancy-section.ts (new "Uploaded" label + it is not
# "needs attention"), app/dashboard/tenancies/[id]/page.tsx (hasUploadedLease
# derivation + done flag), scripts/test-tenancy-section.ts (2 new cases).
#
# NOTE on the sibling findings: Codex #8 (People page "0 documents") did NOT
# reproduce in live data - both tenants resolve all 4 docs via their tenancy, so
# it was captured before the uploads. Codex #3 was already fixed (S447/S448). No
# code for either.
#
# Gate: tsc clean; eslint clean; test-tenancy-section 18/0.
#
# POST-DEPLOY LIVE QA: open a tenancy that has an uploaded (not in-app) lease PDF
# in its vault - the Lease document card reads "Uploaded" (not "Not started") and
# shows done; a tenancy with a real in-app draft/sent/executed lease is unchanged.
set -euo pipefail
cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
git rev-parse --is-inside-work-tree >/dev/null
git add \
  'lib/tenancy-section.ts' \
  'app/dashboard/tenancies/[id]/page.tsx' \
  'scripts/test-tenancy-section.ts' \
  DEPLOY-S450B-LEASE-UPLOADED-STATUS.sh
git commit -m "S450b: lease-document card reads 'Uploaded' when a signed lease PDF is in the vault with no in-app lease doc (Codex dogfood #6 handoff-confidence). Code only, no migration."
git push
echo
echo "Pushed. No migration. Verify the Vercel deploy for this SHA is READY (KI677)."
git rev-parse --short HEAD
