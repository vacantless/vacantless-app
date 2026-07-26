import type { IntakeField, IntakePreview } from "./intake-preview";

// ============================================================================
// Stage 2 "Add property details" — pure view logic (S584).
// No DOM / IO — unit-testable (scripts/test-stage2-add-details.ts).
//
// The three intake methods reuse EXISTING rails (no new plumbing):
//  - email    -> the org's private ingest address + the Captures inbox
//  - document -> Properties, where MLS-PDF + listing-image import already live
//  - manual   -> Properties, the "start fresh" add form
// The read panel renders whatever `toIntakePreview` (S580) produced, or an
// honest empty state until a real intake has run.
// ============================================================================

export type Stage2MethodId = "email" | "document" | "manual";

export type Stage2Method = {
  id: Stage2MethodId;
  // Keys into the next-intl `stage2` catalog (must exist in en.json + fr.json).
  titleKey: "cardEmailTitle" | "cardDocTitle" | "cardManualTitle";
  bodyKey: "cardEmailBody" | "cardDocBody" | "cardManualBody";
  href: string;
};

export const STAGE2_METHODS: readonly Stage2Method[] = [
  {
    id: "email",
    titleKey: "cardEmailTitle",
    bodyKey: "cardEmailBody",
    href: "/dashboard/captures",
  },
  {
    id: "document",
    titleKey: "cardDocTitle",
    bodyKey: "cardDocBody",
    href: "/dashboard/properties",
  },
  {
    id: "manual",
    titleKey: "cardManualTitle",
    bodyKey: "cardManualBody",
    href: "/dashboard/properties",
  },
];

export type Stage2FieldStatusKey = "found" | "pleaseCheck";

// stage2.found / stage2.pleaseCheck. Today every toIntakePreview field is
// found:true; the pleaseCheck branch is ready for future not-found fields.
export function stage2FieldStatusKey(found: boolean): Stage2FieldStatusKey {
  return found ? "found" : "pleaseCheck";
}

export type Stage2Preview = {
  rows: IntakeField[];
  publicDescription: string | null;
  hasSource: boolean;
};

// Adapt a read-model IntakePreview (from S580 toIntakePreview) into the panel's
// render shape. Null when no intake has run yet -> the screen shows the
// "pick one way to start" empty state. Field LABELS come from the read model
// as-is (English today); label i18n is a later slice, not a made-up value.
export function toStage2Preview(preview: IntakePreview | null): Stage2Preview {
  if (!preview) {
    return { rows: [], publicDescription: null, hasSource: false };
  }
  return {
    rows: preview.fields,
    publicDescription: preview.publicDescription,
    hasSource: true,
  };
}
