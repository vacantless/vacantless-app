"use client";

import { useEffect } from "react";

// SectionDeeplinkOpener — IA Step 4 slice 2 (S280). The rental page's sections
// are collapsible <details> (see CollapsibleSection). The lifecycle rail, the
// next-action CTA, and the share-readiness links all deep-link to anchors that
// may live inside a collapsed section (e.g. #property-photos inside Market, or
// #listing-description inside the Set up form). This client enhancer makes those
// links open the section instead of silently scrolling to a hidden element.
//
// It reveals on three triggers so it works regardless of how the hash changes:
//   1. initial mount (page loaded with a #hash)
//   2. the hashchange event (browser back/forward, plain anchor clicks)
//   3. capture-phase clicks on any in-page anchor — because Next.js <Link>
//      same-page hash navigation uses history.pushState, which fires neither
//      hashchange nor popstate. The rail is built from <Link>, so without this
//      the rail clicks would not open the target section.
export function SectionDeeplinkOpener() {
  useEffect(() => {
    const revealId = (rawId: string) => {
      if (!rawId) return;
      let id = rawId;
      try {
        id = decodeURIComponent(rawId);
      } catch {
        // keep raw id on malformed escapes
      }
      const el = document.getElementById(id);
      if (!el) return;
      // Open the target itself (if it is a <details>) and every <details>
      // ancestor, so a nested anchor reveals all the sections wrapping it.
      let node: HTMLElement | null = el;
      while (node) {
        if (node instanceof HTMLDetailsElement) node.open = true;
        node = node.parentElement;
      }
      // Scroll after the now-open sections have laid out.
      requestAnimationFrame(() =>
        el.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    };

    const revealFromHash = () => {
      const hash = window.location.hash;
      if (hash.length > 1) revealId(hash.slice(1));
    };

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      const hashIdx = href.indexOf("#");
      if (hashIdx < 0) return;
      const id = href.slice(hashIdx + 1);
      if (!id || !document.getElementById(id)) return;
      // Let the navigation settle (pushState + scroll), then reveal.
      setTimeout(() => revealId(id), 0);
    };

    revealFromHash();
    window.addEventListener("hashchange", revealFromHash);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("hashchange", revealFromHash);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  return null;
}
