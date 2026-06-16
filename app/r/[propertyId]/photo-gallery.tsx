"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Public listing photo gallery with a click-to-expand lightbox. Renders the
 * cover hero + a thumbnail grid (same layout as before); clicking any photo
 * opens a full-screen overlay with prev/next + keyboard nav (←/→/Esc). Pure
 * client state, no storage. Photos arrive pre-ordered (cover first) from the
 * RPC; an empty array renders nothing.
 */
export function PhotoGallery({
  address,
  photos,
}: {
  address: string;
  photos: string[];
}) {
  const [open, setOpen] = useState<number | null>(null);
  const count = photos.length;

  const close = useCallback(() => setOpen(null), []);
  const show = useCallback(
    (i: number) => setOpen(((i % count) + count) % count),
    [count],
  );

  useEffect(() => {
    if (open === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(null);
      else if (e.key === "ArrowRight") setOpen((o) => (o === null ? o : (o + 1) % count));
      else if (e.key === "ArrowLeft")
        setOpen((o) => (o === null ? o : (o - 1 + count) % count));
    }
    document.addEventListener("keydown", onKey);
    // Lock background scroll while the overlay is up.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, count]);

  if (count === 0) return null;
  const [cover, ...rest] = photos;

  return (
    <div className="mt-6 space-y-2">
      <button
        type="button"
        onClick={() => show(0)}
        className="block w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-100"
        aria-label="Open photo 1"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cover}
          alt={`${address} - photo 1`}
          className="max-h-[28rem] w-full object-cover transition hover:opacity-95"
        />
      </button>
      {rest.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {rest.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => show(i + 1)}
              className="aspect-[4/3] overflow-hidden rounded-lg border border-gray-200 bg-gray-100"
              aria-label={`Open photo ${i + 2}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`${address} - photo ${i + 2}`}
                className="h-full w-full object-cover transition hover:opacity-90"
              />
            </button>
          ))}
        </div>
      )}

      {open !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label={`Photo ${open + 1} of ${count}`}
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1 text-xl leading-none text-white hover:bg-white/20"
          >
            ✕
          </button>
          {count > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                show(open - 1);
              }}
              aria-label="Previous photo"
              className="absolute left-4 rounded-full bg-white/10 px-3 py-2 text-2xl leading-none text-white hover:bg-white/20"
            >
              ‹
            </button>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photos[open]}
            alt={`${address} - photo ${open + 1}`}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-full rounded-lg object-contain"
          />
          {count > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                show(open + 1);
              }}
              aria-label="Next photo"
              className="absolute right-4 rounded-full bg-white/10 px-3 py-2 text-2xl leading-none text-white hover:bg-white/20"
            >
              ›
            </button>
          )}
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white">
            {open + 1} / {count}
          </span>
        </div>
      )}
    </div>
  );
}
