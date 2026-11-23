"use client";

import { useEffect } from "react";

// S800 (REVIEW-S799 item 8): counts one visit to this page (app/api/funnel/visit).
// Same host as the page, so no cross-site request and no extra cookie rules.
// S835i: on the homepage it also reports each section the visitor brings into
// view (app/api/funnel/seen), so we can see how far down people get. It waits
// for the visit call first, because that call sets the browser id. Sections
// are sent in small batches, and once more when the page is left.
export function VisitBeacon({ page, sections }: { page: "home" | "signup"; sections?: readonly string[] }) {
  useEffect(() => {
    let stop = () => {};
    let gone = false;
    fetch(`/api/funnel/visit?page=${page}`, { method: "POST", keepalive: true })
      .catch(() => {})
      .then(() => {
        if (gone || !sections?.length || typeof IntersectionObserver === "undefined") return;
        stop = watchSections(sections);
      });
    return () => {
      gone = true;
      stop();
    };
    // The section list is fixed for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);
  return null;
}

function watchSections(sections: readonly string[]): () => void {
  const sent = new Set<string>();
  let queue: string[] = ["top"];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    fetch(`/api/funnel/seen?s=${batch.join(",")}`, { method: "POST", keepalive: true }).catch(() => {});
  };
  const add = (id: string) => {
    if (sent.has(id)) return;
    sent.add(id);
    queue.push(id);
    if (!timer) timer = setTimeout(flush, 2000);
  };
  sent.add("top");
  timer = setTimeout(flush, 2000);

  // A section counts once its top edge is a quarter of the way up the screen.
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.seen;
        if (e.isIntersecting && id) {
          add(id);
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: "0px 0px -25% 0px" },
  );
  for (const id of sections) {
    const el = document.querySelector<HTMLElement>(`[data-seen="${id}"]`) ?? document.getElementById(id);
    if (!el) continue;
    el.dataset.seen = id;
    io.observe(el);
  }
  const onHide = () => {
    if (document.visibilityState === "hidden") flush();
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", flush);
  return () => {
    io.disconnect();
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", flush);
    flush();
  };
}
