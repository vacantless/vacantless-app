"use client";

// S802 (REVIEW-S799 item 9): a "?" in the dashboard header. It opens the
// how-to video for the page you are on (lib/page-help.ts), a link to all the
// videos, and an email link.
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { HOW_TO_PATH, HOW_TO_VIDEOS } from "@/lib/how-to-videos";
import { HELP_EMAIL, helpVideosFor } from "@/lib/page-help";

export function PageHelp() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const videos = helpVideosFor(pathname);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    setPlaying(videos[0]?.n ?? null);
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const current = HOW_TO_VIDEOS.find((v) => v.n === playing) ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Help for this page"
        title="Help for this page"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/40 text-base font-bold hover:bg-white/15"
      >
        ?
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center print:hidden"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Help"
            className="w-full max-w-xl rounded-xl bg-white p-5 text-slate-900 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-lg font-bold">{videos.length > 0 ? "Help for this page" : "How-to videos"}</h2>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            {current && (
              <div className="mt-3">
                <video
                  key={current.n}
                  className="aspect-video w-full rounded-lg border border-slate-200 bg-slate-100"
                  src={`/videos/howto-${current.n}.mp4`}
                  poster={`/videos/howto-${current.n}.jpg`}
                  controls
                  preload="none"
                  playsInline
                />
                <p className="mt-2 font-semibold">
                  {current.title} <span className="text-sm font-normal text-slate-500">({current.seconds} s)</span>
                </p>
                <p className="mt-1 text-sm text-slate-600">{current.line}</p>
              </div>
            )}

            {videos.length > 1 && (
              <p className="mt-3 flex flex-wrap gap-2 text-sm">
                {videos.map((v) => (
                  <button
                    key={v.n}
                    type="button"
                    onClick={() => setPlaying(v.n)}
                    className={`rounded-lg border px-3 py-1 ${v.n === playing ? "border-slate-800 font-semibold" : "border-slate-300 hover:bg-slate-50"}`}
                  >
                    {v.title}
                  </button>
                ))}
              </p>
            )}

            {videos.length === 0 && (
              <ol className="mt-3 space-y-1 text-sm">
                {HOW_TO_VIDEOS.map((v) => (
                  <li key={v.n}>
                    <button
                      type="button"
                      onClick={() => setPlaying(v.n)}
                      className={`text-left underline-offset-2 hover:underline ${v.n === playing ? "font-semibold" : ""}`}
                    >
                      {v.n}. {v.title} <span className="text-slate-500">({v.seconds} s)</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}

            <p className="mt-4 border-t border-slate-200 pt-3 text-sm text-slate-600">
              <a href={HOW_TO_PATH} target="_blank" rel="noreferrer" className="font-semibold text-slate-900 underline">
                All how-to videos
              </a>
              {" · "}
              Stuck? Email{" "}
              <a href={`mailto:${HELP_EMAIL}`} className="font-semibold text-slate-900 underline">
                {HELP_EMAIL}
              </a>
              {" "}and we will help.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
