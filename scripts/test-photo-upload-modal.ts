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

type FocusTarget = "first" | "last" | null;

function modalTabTarget({
  focusableCount,
  activeIndex,
  shiftKey,
}: {
  focusableCount: number;
  activeIndex: number;
  shiftKey: boolean;
}): FocusTarget {
  if (focusableCount <= 0) return null;
  if (activeIndex < 0) return shiftKey ? "last" : "first";
  if (shiftKey && activeIndex === 0) return "last";
  if (!shiftKey && activeIndex === focusableCount - 1) return "first";
  return null;
}

type FocusCandidate = {
  label: string;
  tag:
    | "a"
    | "button"
    | "input"
    | "select"
    | "textarea"
    | "div"
    | "span";
  href?: string;
  tabindex?: string;
  type?: string;
  disabled?: boolean;
  hidden?: boolean;
  ancestorHidden?: boolean;
  display?: "block" | "none";
  visibility?: "visible" | "hidden";
  offsetWidth?: number;
  offsetHeight?: number;
  rectCount?: number;
};

function matchesFocusableSelector(candidate: FocusCandidate): boolean {
  if (candidate.tag === "a") return Boolean(candidate.href);
  if (
    candidate.tag === "button" ||
    candidate.tag === "input" ||
    candidate.tag === "select" ||
    candidate.tag === "textarea"
  ) {
    return true;
  }
  return Boolean(candidate.tabindex && candidate.tabindex !== "-1");
}

function isVisibleFocusableCandidate(candidate: FocusCandidate): boolean {
  if (candidate.hidden || candidate.ancestorHidden) return false;
  if (candidate.disabled) return false;
  if (candidate.tag === "input" && candidate.type === "hidden") return false;
  if (candidate.display === "none" || candidate.visibility === "hidden") {
    return false;
  }
  return Boolean(
    candidate.offsetWidth || candidate.offsetHeight || candidate.rectCount,
  );
}

function selectedFocusableLabels(candidates: FocusCandidate[]): string[] {
  return candidates
    .filter(matchesFocusableSelector)
    .filter(isVisibleFocusableCandidate)
    .map((candidate) => candidate.label);
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
  "photo modal captures the opener before opening",
  /openerRef = useRef<HTMLElement \| null>\(null\)/.test(modalSource) &&
    /document\.activeElement instanceof HTMLElement[\s\S]*setOpen\(true\)/.test(
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
  "photo modal portals outside the app shell",
  /import \{ createPortal \} from "react-dom";/.test(modalSource) &&
    /return createPortal\(/.test(modalSource) &&
    /document\.body/.test(modalSource),
);
ok(
  "photo modal makes the page shell inert while open",
  /document\.querySelector\("main"\)/.test(modalSource) &&
    /setAttribute\("inert", ""\)/.test(modalSource) &&
    /removeAttribute\("inert"\)/.test(modalSource),
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

ok(
  "focus trap wraps first to last on Shift+Tab",
  modalTabTarget({
    focusableCount: 3,
    activeIndex: 0,
    shiftKey: true,
  }) === "last",
);
ok(
  "focus trap wraps last to first on Tab",
  modalTabTarget({
    focusableCount: 3,
    activeIndex: 2,
    shiftKey: false,
  }) === "first",
);
ok(
  "focus trap keeps middle focus in normal flow",
  modalTabTarget({
    focusableCount: 3,
    activeIndex: 1,
    shiftKey: false,
  }) === null,
);
ok(
  "focus trap handles focus outside the dialog",
  modalTabTarget({
    focusableCount: 3,
    activeIndex: -1,
    shiftKey: false,
  }) === "first" &&
    modalTabTarget({
      focusableCount: 3,
      activeIndex: -1,
      shiftKey: true,
    }) === "last",
);
ok(
  "focus trap empty list is a no-op",
  modalTabTarget({
    focusableCount: 0,
    activeIndex: -1,
    shiftKey: true,
  }) === null,
);
ok(
  "focusable selection excludes hidden and disabled controls",
  selectedFocusableLabels([
    { label: "link", tag: "a", href: "#x", rectCount: 1 },
    { label: "disabled", tag: "button", disabled: true, rectCount: 1 },
    { label: "hidden-input", tag: "input", type: "hidden", rectCount: 1 },
    { label: "hidden-ancestor", tag: "button", ancestorHidden: true, rectCount: 1 },
    { label: "display-none", tag: "button", display: "none", rectCount: 1 },
    { label: "visibility-hidden", tag: "button", visibility: "hidden", rectCount: 1 },
    { label: "tab-minus-one", tag: "div", tabindex: "-1", rectCount: 1 },
    { label: "custom-tab", tag: "div", tabindex: "0", offsetWidth: 10 },
  ]).join(",") === "link,custom-tab",
);
ok(
  "focusable selector includes anchors buttons fields and non-negative tabindex",
  modalSource.includes(
    'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
  ),
);

console.log(`photo-upload-modal: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
