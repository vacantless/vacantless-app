export const PHOTO_UPLOAD_MODAL_FOCUSABLE_SELECTOR =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

export type PhotoUploadModalFocusTarget = "first" | "last" | null;

export type PhotoUploadModalFocusableCandidate = {
  hiddenAncestor: boolean;
  disabled: boolean;
  hiddenInput: boolean;
  display: string;
  visibility: string;
  hasLayout: boolean;
};

export function isPhotoUploadModalFocusableCandidate({
  hiddenAncestor,
  disabled,
  hiddenInput,
  display,
  visibility,
  hasLayout,
}: PhotoUploadModalFocusableCandidate): boolean {
  if (hiddenAncestor) return false;
  if (disabled) return false;
  if (hiddenInput) return false;
  if (display === "none" || visibility === "hidden") return false;
  return hasLayout;
}

export function photoUploadModalTabTarget({
  focusableCount,
  activeIndex,
  shiftKey,
}: {
  focusableCount: number;
  activeIndex: number;
  shiftKey: boolean;
}): PhotoUploadModalFocusTarget {
  if (focusableCount <= 0) return null;
  if (activeIndex < 0) return shiftKey ? "last" : "first";
  if (shiftKey && activeIndex === 0) return "last";
  if (!shiftKey && activeIndex === focusableCount - 1) return "first";
  return null;
}
