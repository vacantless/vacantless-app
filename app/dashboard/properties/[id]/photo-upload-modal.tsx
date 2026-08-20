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
import {
  PHOTO_UPLOAD_MODAL_FOCUSABLE_SELECTOR,
  isPhotoUploadModalFocusableCandidate,
  photoUploadModalTabTarget,
} from "@/lib/photo-upload-modal-focus";
import type { PropertyPhotoView } from "../actions";
import { PhotoUploadWorkspace } from "./photo-manager";

export const PHOTO_UPLOAD_MODAL_EVENT = "vacantless:open-photo-upload";

type PhotoUploadLinkProps = {
  href?: string;
  className?: string;
  children: ReactNode;
};

type InertedElement = {
  element: HTMLElement;
  hadInert: boolean;
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
  const style = window.getComputedStyle(element);

  return isPhotoUploadModalFocusableCandidate({
    hiddenAncestor: Boolean(element.closest("[hidden]")),
    disabled: element.matches(":disabled"),
    hiddenInput: element instanceof HTMLInputElement && element.type === "hidden",
    display: style.display,
    visibility: style.visibility,
    hasLayout: Boolean(
      element.offsetWidth ||
        element.offsetHeight ||
        element.getClientRects().length,
    ),
  });
}

function getPhotoUploadModalFocusableElements(
  root: HTMLElement,
): HTMLElement[] {
  return Array.from(
    root.querySelectorAll(PHOTO_UPLOAD_MODAL_FOCUSABLE_SELECTOR),
  ).filter(isFocusableModalElement);
}

function inertBodySiblingsExcept(modalRoot: HTMLElement | null): InertedElement[] {
  if (!modalRoot) return [];

  const targets = Array.from(document.body.children).filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement && element !== modalRoot,
  );

  const inertedElements = targets.map((element) => ({
    element,
    hadInert: element.hasAttribute("inert"),
  }));
  inertedElements.forEach(({ element }) => element.setAttribute("inert", ""));
  return inertedElements;
}

function restoreInertedElements(inertedElements: InertedElement[]) {
  inertedElements.forEach(({ element, hadInert }) => {
    if (!hadInert) element.removeAttribute("inert");
  });
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
  const overlayRef = useRef<HTMLDivElement | null>(null);
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
    const inertedElements = inertBodySiblingsExcept(overlayRef.current);

    document.body.style.overflow = "hidden";

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
      restoreInertedElements(inertedElements);
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
      ref={overlayRef}
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
            <p className="mt-1 text-sm text-gray-600">
              Add the photos, then keep publishing.
            </p>
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
          introCopy="Choose photos from your computer. We will save them to this listing and bring you back to the publish flow."
          showHeader={false}
          showExistingPhotos={false}
          showImportTools={false}
          showStorageUpsell={false}
          compactPickedList
          onUploadSuccess={() => setOpen(false)}
          className="p-0"
        />
      </div>
    </div>,
    document.body,
  );
}
