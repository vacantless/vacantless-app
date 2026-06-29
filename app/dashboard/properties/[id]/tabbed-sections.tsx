"use client";

import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icons } from "@/components/icons";

// TabbedSections — rental-detail redesign (Codex design audit #2, S377).
// Replaces the long single-scroll stack of CollapsibleSections with task tabs
// under the (unchanged) lifecycle rail + next-action card, fixing the action
// hierarchy: the operator sees ONE work surface at a time and switches by tab.
//
// Why a client wrapper over server-rendered panels: each TabPanel's content is
// rendered on the server (forms, data, the existing section markup) and passed
// through as children. We only toggle visibility with the `hidden` attribute
// (display:none) so the content STAYS in the DOM when inactive — exactly like
// the old <details> kept anchors resolvable while collapsed. That preserves the
// deep-link contract: the rail steps, the next-action CTA, and the share-
// readiness links all point at anchors (#share, #property-photos,
// #rental-details, #listing-description, #detectors/#equipment/#appliances,
// #inquiries) that live inside a panel. This component owns the reveal logic
// that the old SectionDeeplinkOpener did, plus the new step of ACTIVATING the
// tab whose panel contains the anchor before scrolling.

type TabPanelProps = {
  /** Stable tab id, used for the tab button, data-tabpanel, and initialTab. */
  tabId: string;
  /** Tab label shown in the bar. */
  label: string;
  /** Optional count chip (e.g. number of inquiries). */
  badge?: ReactNode;
  /** Renders a check on the tab when this lifecycle step is complete. */
  done?: boolean;
  /**
   * Optional extra DOM id placed on the panel container so an existing
   * deep-link anchor that pointed at the whole section (e.g. #rental-details,
   * #inquiries) still resolves.
   */
  anchorId?: string;
  children: ReactNode;
};

// TabPanel is a declarative marker: TabbedSections reads its props and renders
// the panel wrapper itself. Rendering its children directly keeps it valid if
// ever used standalone.
export function TabPanel({ children }: TabPanelProps) {
  return <>{children}</>;
}

export function TabbedSections({
  initialTab,
  children,
}: {
  initialTab: string;
  children: ReactNode;
}) {
  // Collect the TabPanel children and their props.
  const panels = Children.toArray(children).filter(
    (c): c is React.ReactElement<TabPanelProps> =>
      isValidElement(c) &&
      typeof (c.props as Partial<TabPanelProps>).tabId === "string",
  );

  const tabIds = panels.map((p) => p.props.tabId);
  const firstTab = tabIds[0] ?? initialTab;
  const validInitial = tabIds.includes(initialTab) ? initialTab : firstTab;

  const [active, setActive] = useState(validInitial);
  const activeRef = useRef(active);
  activeRef.current = active;
  // When a deep-link targets a panel that isn't active yet, we switch tabs
  // first (a re-render shows the panel) and stash the anchor to scroll to once
  // it's laid out.
  const pendingScroll = useRef<string | null>(null);

  const openDetailsAndScroll = useCallback((el: HTMLElement) => {
    // Open the target itself and every <details> ancestor (the Assets tab still
    // nests collapsible sub-sections), then scroll once laid out.
    let node: HTMLElement | null = el;
    while (node) {
      if (node instanceof HTMLDetailsElement) node.open = true;
      node = node.parentElement;
    }
    requestAnimationFrame(() =>
      el.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }, []);

  const reveal = useCallback(
    (rawId: string) => {
      if (!rawId) return;
      let id = rawId;
      try {
        id = decodeURIComponent(rawId);
      } catch {
        // keep raw id on malformed escapes
      }
      const el = document.getElementById(id);
      if (!el) return;
      const panel = el.closest<HTMLElement>("[data-tabpanel]");
      const panelTab = panel?.getAttribute("data-tabpanel") ?? null;
      if (panelTab && panelTab !== activeRef.current) {
        // Switch tabs; the [active] effect scrolls once the panel is visible.
        pendingScroll.current = id;
        setActive(panelTab);
      } else {
        openDetailsAndScroll(el);
      }
    },
    [openDetailsAndScroll],
  );

  // After a tab switch triggered by a deep-link, scroll to the stashed anchor.
  useEffect(() => {
    const id = pendingScroll.current;
    if (!id) return;
    pendingScroll.current = null;
    const el = document.getElementById(id);
    if (el) openDetailsAndScroll(el);
  }, [active, openDetailsAndScroll]);

  // Deep-link triggers — mirror the old SectionDeeplinkOpener: initial hash,
  // hashchange (back/forward, plain anchors), and capture-phase clicks on any
  // in-page anchor (Next.js <Link> hash navigation uses history.pushState,
  // which fires neither hashchange nor popstate — the rail is built from
  // <Link>, so without this its clicks would not switch tabs).
  useEffect(() => {
    const revealFromHash = () => {
      const hash = window.location.hash;
      if (hash.length > 1) reveal(hash.slice(1));
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
      setTimeout(() => reveal(id), 0);
    };
    revealFromHash();
    window.addEventListener("hashchange", revealFromHash);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("hashchange", revealFromHash);
      document.removeEventListener("click", onClick, true);
    };
  }, [reveal]);

  return (
    <div>
      {/* Tab bar — horizontally scrollable on narrow screens. */}
      <div
        role="tablist"
        aria-label="Rental sections"
        className="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200"
      >
        {panels.map((p) => {
          const { tabId, label, badge, done } = p.props;
          const isActive = tabId === active;
          return (
            <button
              key={tabId}
              type="button"
              role="tab"
              id={`tab-${tabId}`}
              aria-selected={isActive}
              aria-controls={`tabpanel-${tabId}`}
              onClick={() => setActive(tabId)}
              className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
                isActive
                  ? "border-brand text-brand"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800"
              }`}
            >
              <span>{label}</span>
              {badge != null && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
                    isActive
                      ? "bg-brand/10 text-brand"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {badge}
                </span>
              )}
              {done && (
                <span
                  aria-label="done"
                  className="flex h-4 w-4 items-center justify-center rounded-full bg-brand text-white"
                >
                  <Icons.check className="h-2.5 w-2.5" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Panels — kept mounted; hidden when inactive so deep-link anchors and
          form state inside survive a tab switch. */}
      {panels.map((p) => {
        const { tabId, anchorId, children: panelChildren } = p.props;
        const isActive = tabId === active;
        return (
          <div
            key={tabId}
            id={anchorId}
            data-tabpanel={tabId}
            role="tabpanel"
            aria-labelledby={`tab-${tabId}`}
            hidden={!isActive}
            className="scroll-mt-6"
          >
            {panelChildren}
          </div>
        );
      })}
    </div>
  );
}
