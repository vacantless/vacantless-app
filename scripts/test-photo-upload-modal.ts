// Source regression tests for the focused property-photo upload modal.
// Run: npx tsx scripts/test-photo-upload-modal.ts

import { readFileSync } from "fs";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

function count(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

const modalSource = readFileSync(
  "app/dashboard/properties/[id]/photo-upload-modal.tsx",
  "utf8",
);
const managerSource = readFileSync(
  "app/dashboard/properties/[id]/photo-manager.tsx",
  "utf8",
);
const pageSource = readFileSync(
  "app/dashboard/properties/[id]/page.tsx",
  "utf8",
);
const nextActionCardSource = readFileSync(
  "app/dashboard/properties/[id]/next-action-card.tsx",
  "utf8",
);
const distributeSource = readFileSync(
  "app/dashboard/properties/[id]/distribute-tab.tsx",
  "utf8",
);
const tabbedSource = readFileSync(
  "app/dashboard/properties/[id]/tabbed-sections.tsx",
  "utf8",
);
const deeplinkSource = readFileSync(
  "app/dashboard/properties/[id]/section-deeplink-opener.tsx",
  "utf8",
);

ok(
  "photo modal is a client component",
  modalSource.startsWith('"use client";'),
);
ok(
  "photo modal exposes the shared open event",
  /PHOTO_UPLOAD_MODAL_EVENT = "vacantless:open-photo-upload"/.test(
    modalSource,
  ),
);
ok(
  "photo modal trigger keeps the property-photos href fallback",
  /href = "#property-photos"/.test(modalSource) &&
    /href=\{href\}/.test(modalSource),
);
ok(
  "photo modal trigger marks links for deeplink skip",
  /data-photo-upload-modal-trigger="true"/.test(modalSource),
);
ok(
  "photo modal trigger only intercepts normal clicks",
  /isPlainPrimaryClick\(event\)/.test(modalSource) &&
    /event\.preventDefault\(\);/.test(modalSource),
);
ok(
  "photo modal dispatches the open event",
  /window\.dispatchEvent\(new Event\(PHOTO_UPLOAD_MODAL_EVENT\)\)/.test(
    modalSource,
  ),
);
ok(
  "photo modal renders a dialog",
  /role="dialog"/.test(modalSource) && /aria-modal="true"/.test(modalSource),
);
ok(
  "photo modal locks background scroll while open",
  /document\.body\.style\.overflow = "hidden";/.test(modalSource),
);
ok(
  "photo modal uses the shared photo upload workspace",
  /<PhotoUploadWorkspace/.test(modalSource),
);
ok(
  "photo modal keeps URL and Dropbox importers out of the focused dialog",
  /showImportTools=\{false\}/.test(modalSource),
);
ok(
  "photo modal closes after successful upload",
  /onUploadSuccess=\{\(\) => setOpen\(false\)\}/.test(modalSource),
);

ok(
  "photo manager exports the shared upload workspace",
  /export function PhotoUploadWorkspace/.test(managerSource),
);
ok(
  "inline photo manager keeps property-photos anchor id",
  /sectionId="property-photos"/.test(managerSource),
);
ok(
  "photo manager file input keeps browser-automation label",
  /aria-label="Add photos to this rental"/.test(managerSource),
);
ok(
  "shared photo workspace refreshes after upload",
  /router\.refresh\(\);\s*onUploadSuccess\?\.\(\);/.test(managerSource),
);
ok(
  "inline photo manager still has optional import tools",
  /showImportTools &&/.test(managerSource) &&
    /importPropertyPhotosFromUrls/.test(managerSource) &&
    /DropboxFolderImport/.test(managerSource),
);
ok(
  "photo modal is mounted before tab panels can hide it",
  pageSource.indexOf("<PhotoUploadModal") > -1 &&
    pageSource.indexOf("<PhotoUploadModal") <
      pageSource.indexOf("<TabbedSections"),
);
ok(
  "page-level photo links use the modal trigger",
  count(pageSource, /<PhotoUploadLink/g) === 3,
);
ok(
  "page has no raw property-photo anchor affordances",
  !/<a\s+[^>]*href="#property-photos"/.test(pageSource),
);
ok(
  "next-action photo CTA uses the modal trigger",
  /cta\.href\.endsWith\("#property-photos"\)/.test(nextActionCardSource) &&
    /<PhotoUploadLink/.test(nextActionCardSource),
);
ok(
  "distribute photo nudge and checklist use the modal trigger",
  count(distributeSource, /<PhotoUploadLink/g) === 2,
);
ok(
  "distribute checklist keeps add-photo done and action semantics",
  /label: "Add photos"[\s\S]*href: "#property-photos"[\s\S]*action: hasPhotos \? "Review" : "Add photos"[\s\S]*done: hasPhotos/.test(
    distributeSource,
  ),
);
ok(
  "tabbed panels stay mounted with hidden attribute",
  /hidden=\{!isActive\}/.test(tabbedSource),
);
ok(
  "tabbed anchor contract still names property photos",
  /#share, #property-photos,[\s\S]*#rental-details, #listing-description,[\s\S]*#detectors\/#equipment\/#appliances,[\s\S]*#inquiries/.test(
    tabbedSource,
  ),
);
ok(
  "tabbed deeplink opener keeps mount, hashchange, and capture click triggers",
  /revealFromHash\(\);/.test(tabbedSource) &&
    /window\.addEventListener\("hashchange", revealFromHash\)/.test(
      tabbedSource,
    ) &&
    /document\.addEventListener\("click", onClick, true\)/.test(tabbedSource),
);
ok(
  "tabbed deeplink opener skips enhanced photo-modal clicks",
  /data-photo-upload-modal-trigger/.test(tabbedSource),
);
ok(
  "legacy section deeplink opener keeps mount, hashchange, and capture click triggers",
  /revealFromHash\(\);/.test(deeplinkSource) &&
    /window\.addEventListener\("hashchange", revealFromHash\)/.test(
      deeplinkSource,
    ) &&
    /document\.addEventListener\("click", onClick, true\)/.test(
      deeplinkSource,
    ),
);
ok(
  "legacy section deeplink opener skips enhanced photo-modal clicks",
  /data-photo-upload-modal-trigger/.test(deeplinkSource),
);

console.log(`photo-upload-modal: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
