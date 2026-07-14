#!/usr/bin/env bash
# S426 - Fold Codex's two P2s on the lease-OCR feature (14c997a..08acb6c review).
#   P2a: PII guard missed DOB aliases (birthdate/born) + licence abbreviations
#        (DL/licence #), and truncated before detecting -> now detects on the
#        FULL string before slicing. (lib/lease-extract.ts + tests)
#   P2b: LEASE_OCR_ENABLED was only enforced in the page render, not the server
#        action -> extractLease now returns "unconfigured" unless the flag is set,
#        before claiming a scan credit or calling the model. (actions.ts)
# Gate: lease-extract tests 86/0, tsc --noEmit clean. Feature still ships DARK.
set -euo pipefail
cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
git add lib/lease-extract.ts app/dashboard/tenancies/actions.ts scripts/test-lease-extract.ts
git commit -m "S426: lease-OCR Codex P2 fixes - expand PII guard (DOB/licence aliases + detect-before-truncate) + server-side LEASE_OCR_ENABLED gate on extractLease"
git push origin main
