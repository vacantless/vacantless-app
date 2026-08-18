"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icons } from "@/components/icons";
import type { StorageUpsell } from "@/lib/billing";
import type { PropertyPhotoView } from "../actions";
import { PhotoUploadWorkspace } from "./photo-manager";

export const PHOTO_UPLOAD_MODAL_EVENT = "vacantless:open-photo-upload";
export const PHOTO_UPLOAD_MODAL_FOCUSABLE_SELECTOR =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

type PhotoUploadModalFocusTarget = "first" | "last" | null;

type PhotoUploadLinkProps = {
  href?: string;
  className?: string;
  children: ReactNode;
};

function isPlainPrimaryClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey
  );
}

function isFocusableModalElement(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.closest("[hidden]")) return false;
  if (element.matches(":disabled")) return false;
  if (element instanceof HTMLInputElement && element.type === "hidden") {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;

  return Boolean(
    element.offsetWidth ||
      element.offsetHeight ||
      element.getClientRects().length,
  );
}

export function getPhotoUploadModalFocusableElements(
  root: HTMLElement,
): HTMLElement[] {
  return Array.from(
    root.querySelectorAll(PHOTO_UPLOAD_MODAL_FOCUSABLE_SELECTOR),
  ).filter(isFocusableModalElement);
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

export function PhotoUploadLink({
  href = "#property-photos",
  className,
  children,
}: PhotoUploadLinkProps) {
  return (
    <a
      href={href}
      data-photo-upload-modal-trigger="true"
      aria-haspopup="dialog"
      className={className}
      onClick={(event) => {
        if (!isPlainPrimaryClick(event)) return;
        event.preventDefault();
        window.dispatchEvent(new Event(PHOTO_UPLOAD_MODAL_EVENT));
      }}
    >
      {children}
    </a>
  );
}

export function PhotoUploadModal({
  propertyId,
  initialPhotos,
  photoCap,
  storageUpsell,
}: {
  propertyId: string;
  initialPhotos: PropertyPhotoView[];
  photoCap: number;
  storageUpsell: StorageUpsell;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const openModal = () => {
      openerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setOpen(true);
    };
    window.addEventListener(PHOTO_UPLOAD_MODAL_EVENT, openModal);
    return () => window.removeEventListener(PHOTO_UPLOAD_MODAL_EVENT, openModal);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const appShell = document.querySelector("main");
    const appShellHadInert = appShell?.hasAttribute("inert") ?? false;

    document.body.style.overflow = "hidden";
    appShell?.setAttribute("inert", "");

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusableElements = getPhotoUploadModalFocusableElements(dialog);
        const activeIndex = focusableElements.findIndex(
          (element) => element === document.activeElement,
        );
        const target = photoUploadModalTabTarget({
          focusableCount: focusableElements.length,
          activeIndex,
          shiftKey: event.shiftKey,
        });
        if (!target) return;

        event.preventDefault();
        focusableElements[
          target === "first" ? 0 : focusableElements.length - 1
        ]?.focus();
        return;
      }

      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    const focusTimer = window.setTimeout(
      () => closeButtonRef.current?.focus(),
      0,
    );

    return () => {
      document.body.style.overflow = previousOverflow;
      if (!appShellHadInert) appShell?.removeAttribute("inert");
      window.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(focusTimer);
      const opener = openerRef.current;
      if (opener && document.contains(opener)) opener.focus();
      openerRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-xl border border-gray-200 bg-white p-5 text-left shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-white">
                <Icons.page className="h-4 w-4" />
              </span>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Photos
              </p>
            </div>
            <h2 id={titleId} className="text-lg font-semibold text-gray-950">
              Add photos
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>

        <PhotoUploadWorkspace
          propertyId={propertyId}
          initialPhotos={initialPhotos}
          photoCap={photoCap}
          storageUpsell={storageUpsell}
          fileInputId="photo-upload-modal-input"
          showHeader={false}
          showImportTools={false}
          showStorageUpsell={false}
          onUploadSuccess={() => setOpen(false)}
          className="p-0"
        />
      </div>
    </div>,
    document.body,
  );
}
