#!/bin/bash
# S827b: MLS import fills the form on drop, sets unit type and Listed by; big photos save.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-add-property-v2.ts
npx tsx scripts/test-mls-import.ts
npx tsx scripts/test-dropbox-import.ts
npx tsx scripts/test-drive-import.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add lib/photo-shrink.ts lib/dropbox-import.ts lib/dropbox-import-server.ts lib/drive-import.ts lib/mls-import.ts lib/add-property-v2.ts app/dashboard/properties/actions.ts app/dashboard/properties/new/add-property-form.tsx app/realtors/page.tsx scripts/test-add-property-v2.ts COMMIT-S827b-IMPORT-PHOTOS.sh
git commit -m "S827b: an MLS sheet fills the form on drop, and big photos save

Found adding 50 Glenrose Ave B from a Realm data sheet:
- 'Copy from an existing ad' did not say MLS; it now reads 'Import from
  MLS or an existing ad' and the drop box names the Realm data sheet.
- Dropping the PDF only filled a text box; a second button did the work.
  Dropping it now fills the form.
- The sheet's type (Detached) made a basement rental a House. Remarks that
  describe a basement or lower-level apartment now pick Basement apartment
  and fill the floor. An MLS sheet or realtor.ca page sets Listed by to Real
  estate professional.
- Empty 'Extras: Inclusions: Exclusions: Rental Items:' labels no longer end
  up in the description.
- Ten photographer photos (23 MB) failed the save with HTTP 413 and no
  message. Photos are now made smaller in the browser to fit, with a line
  saying so; any that do not fit are named for the rental's page.
- A save that cannot go through now says so under Save draft: too-big
  photos are caught before sending, and a save that stops without leaving
  the page shows 'Your rental did not save'.
- Add rental takes a Dropbox or Google Drive folder link. The rental is
  saved, the link kept, and the photos pulled in at full size.
- The same box takes an iGUIDE (or Matterport, YouTube) tour link, which
  becomes the listing's virtual tour. Both links can go in together.
- A photographer's master Dropbox folder (Leading Image sends one holding
  every shoot) now picks this rental's Gallery folder from its address and
  unit; when that is not clear it asks, as before.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGmkHg5MoubAxfPMx8c"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
