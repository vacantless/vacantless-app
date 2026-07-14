#!/usr/bin/env bash
# S426b - Close Codex's re-review P2 on the lease-OCR PII guard: driver's-licence
# abbreviations with separators (D/L, D.L., "D/L #") were slipping through. The
# bare-abbreviation pattern in lib/lease-extract.ts is now /\bd[./]?l\b/i, and
# tests cover the slash/dot forms. Suite 89/0; tsc clean. Feature still dark.
set -euo pipefail
cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
git add lib/lease-extract.ts scripts/test-lease-extract.ts codex-handoffs/S426-LEASE-OCR-P2-FIXES.md
git commit -m "S426b: lease-OCR PII guard - cover D/L and D.L. licence forms (Codex re-review P2), 89/0"
git push origin main
