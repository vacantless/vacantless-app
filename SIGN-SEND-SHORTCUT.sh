#!/bin/bash
# S816l: signs the "Send to Vacantless" Shortcut with your Apple ID and opens it.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
mkdir -p public/shortcut
shortcuts sign --mode anyone --input shortcut-src/Send-to-Vacantless-unsigned.shortcut --output "public/shortcut/Send to Vacantless.shortcut"
ls -la public/shortcut
open "public/shortcut/Send to Vacantless.shortcut"
echo "== Shortcuts should be open. Click Add Shortcut and paste your key when it asks."
