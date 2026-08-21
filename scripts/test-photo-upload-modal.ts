// Source regression tests for the focused property-photo upload modal.
// Run: npx tsx scripts/test-photo-upload-modal.ts

import { readFileSync } from "fs";
import {
  PHOTO_UPLOAD_MODAL_FOCUSABLE_SELECTOR,
  isPhotoUploadModalFocusableCandidate,
  photoUploadModalTabTarget,
  type PhotoUploadModalFocusableCandidate,
} from "../lib/photo-upload-modal-focus";

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

function focusCandidate(
  overrides: Partial<PhotoUploadModalFocusableCandidate> = {},
): PhotoUploadModalFocusableCandidate {
  return {
    hiddenAncestor: false,
    disabled: false,
    hiddenInput: false,
    display: "block",
    visibility: "visible",
    hasLayout: true,
    ...overrides,
  };
}

function selectedFocusableLabels(
  candidates: Array<{
    label: string;
    candidate: PhotoUploadModalFocusableCandidate;
  }>,
): string[] {
  return candidates
    .filter(({ candidate }) => isPhotoUploadModalFocusableCandidate(candidate))
    .map(({ label }) => label);
}

const modalSource = readFileSync(
  "app/dashboard/properties/[id]/photo-upload-modal.tsx",
  "utf8",
);
const focusTrapSource = readFileSync("lib/photo-upload-modal-focus.ts", "utf8");
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
const openModalBlock =
  modalSource.match(/const openModal = \(\) => \{([\s\S]*?)\n    \};/)?.[1] ??
  "";

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
  "photo modal captures the opener before opening",
  /openerRef = useRef<HTMLElement \| null>\(null\)/.test(modalSource) &&
    /document\.activeElement instanceof HTMLElement/.test(openModalBlock) &&
    /setOpen\(true\)/.test(openModalBlock),
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
  "photo modal imports shared focus helpers from a plain module",
  /from "@\/lib\/photo-upload-modal-focus"/.test(modalSource) &&
    /import \{[\s\S]*PHOTO_UPLOAD_MODAL_FOCUSABLE_SELECTOR[\s\S]*isPhotoUploadModalFocusableCandidate[\s\S]*photoUploadModalTabTarget[\s\S]*\}/.test(
      modalSource,
    ),
);
ok(
  "photo modal portals outside the app shell",
  /import \{ createPortal \} from "react-dom";/.test(modalSource) &&
    /return createPortal\(/.test(modalSource) &&
    /document\.body/.test(modalSource),
);
ok(
  "photo modal makes background body siblings inert while open",
  /inertBodySiblingsExcept/.test(modalSource) &&
    /document\.body\.children/.test(modalSource) &&
    /element !== modalRoot/.test(modalSource) &&
    /setAttribute\("inert", ""\)/.test(modalSource) &&
    /restoreInertedElements\(inertedElements\)/.test(modalSource) &&
    !/document\.querySelector\("main"\)/.test(modalSource),
);
ok(
  "photo modal traps Tab with a fresh focusable query",
  /PHOTO_UPLOAD_MODAL_FOCUSABLE_SELECTOR/.test(modalSource) &&
    /querySelectorAll\(PHOTO_UPLOAD_MODAL_FOCUSABLE_SELECTOR\)/.test(
      modalSource,
    ) &&
    /if \(event\.key === "Tab"\)/.test(modalSource) &&
    /getPhotoUploadModalFocusableElements\(dialog\)/.test(modalSource) &&
    /photoUploadModalTabTarget/.test(modalSource) &&
    /event\.preventDefault\(\);/.test(modalSource),
);
ok(
  "photo modal restores focus to the remembered opener",
  /const opener = openerRef\.current;/.test(modalSource) &&
    /document\.contains\(opener\)/.test(modalSource) &&
    /opener\.focus\(\);/.test(modalSource),
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
  "inline photo manager keeps property-photos anchor on the disclosure",
  /<details[\s\S]*id="property-photos"/.test(managerSource),
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
// S670: the old assertion here required the SimplePostingPlan `steps` array
// (label/href/action/done) to still exist in distribute-tab.tsx. That array was
// DELETED on purpose when AutopilotLaunchCard replaced SimplePostingPlan, so the
// test was asserting the presence of code the redesign removed, and it made this
// branch red on its own. Do NOT restore SimplePostingPlan to satisfy it.
//
// The invariant actually worth protecting is unchanged and is what this now
// checks: when the card's primary action is "add photos", it must go through the
// modal trigger rather than a raw anchor, so the deeplink opener can skip it.
ok(
  "autopilot card can make photos its primary action",
  /primaryHref =[\s\S]{0,400}?"#property-photos"/.test(distributeSource) &&
    /primaryAction =[\s\S]{0,400}?"Add photos"/.test(distributeSource),
);
ok(
  "autopilot card routes the photo primary action through the modal trigger",
  /primaryHref === "#property-photos" \?\s*\(\s*<PhotoUploadLink/.test(
    distributeSource,
  ),
);
ok(
  "SimplePostingPlan stays deleted",
  !/function SimplePostingPlan/.test(distributeSource) &&
    /function AutopilotLaunchCard/.test(distributeSource),
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

ok(
  "focus trap wraps first to last on Shift+Tab",
  photoUploadModalTabTarget({
    focusableCount: 3,
    activeIndex: 0,
    shiftKey: true,
  }) === "last",
);
ok(
  "focus trap wraps last to first on Tab",
  photoUploadModalTabTarget({
    focusableCount: 3,
    activeIndex: 2,
    shiftKey: false,
  }) === "first",
);
ok(
  "focus trap keeps middle focus in normal flow",
  photoUploadModalTabTarget({
    focusableCount: 3,
    activeIndex: 1,
    shiftKey: false,
  }) === null,
);
ok(
  "focus trap handles focus outside the dialog",
  photoUploadModalTabTarget({
    focusableCount: 3,
    activeIndex: -1,
    shiftKey: false,
  }) === "first" &&
    photoUploadModalTabTarget({
      focusableCount: 3,
      activeIndex: -1,
      shiftKey: true,
    }) === "last",
);
ok(
  "focus trap empty list is a no-op",
  photoUploadModalTabTarget({
    focusableCount: 0,
    activeIndex: -1,
    shiftKey: true,
  }) === null,
);
ok(
  "focusable selection excludes hidden and disabled controls",
  selectedFocusableLabels([
    { label: "visible", candidate: focusCandidate() },
    { label: "disabled", candidate: focusCandidate({ disabled: true }) },
    { label: "hidden-input", candidate: focusCandidate({ hiddenInput: true }) },
    {
      label: "hidden-ancestor",
      candidate: focusCandidate({ hiddenAncestor: true }),
    },
    { label: "display-none", candidate: focusCandidate({ display: "none" }) },
    {
      label: "visibility-hidden",
      candidate: focusCandidate({ visibility: "hidden" }),
    },
    { label: "no-layout", candidate: focusCandidate({ hasLayout: false }) },
  ]).join(",") === "visible",
);
ok(
  "focusable selector includes anchors buttons fields and non-negative tabindex",
  PHOTO_UPLOAD_MODAL_FOCUSABLE_SELECTOR ===
    'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])' &&
    focusTrapSource.includes(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
);

console.log(`photo-upload-modal: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
