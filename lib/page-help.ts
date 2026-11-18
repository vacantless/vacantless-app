// S802 (REVIEW-S799 item 9): which how-to videos the "?" in the dashboard
// header opens on each page. First match wins, so longer paths come first.
// A page with no match gets the full list of videos instead.
import { HOW_TO_VIDEOS } from "./how-to-videos";

export const HELP_EMAIL = "hello@vacantless.com";

// [path prefix, video numbers (first one plays)]
export const PAGE_HELP_ROUTES: [string, number[]][] = [
  ["/dashboard/getting-started", [1]],
  ["/dashboard/properties/new", [1]],
  ["/dashboard/properties/import", [1]],
  ["/dashboard/properties/standard-policy", [1]],
  ["/dashboard/properties/", [1, 4]],
  ["/dashboard/properties", [1]],
  ["/dashboard/add-details", [1]],
  ["/dashboard/availability", [2]],
  ["/dashboard/leads/", [3, 6]],
  ["/dashboard/leads", [3]],
  ["/dashboard/replies", [3]],
  ["/dashboard/messages", [3]],
  ["/dashboard/captures", [3]],
  ["/dashboard/sites", [4]],
  ["/dashboard/link-portals", [4]],
  ["/dashboard/send-live", [4]],
  ["/dashboard/site-signin", [4]],
  ["/dashboard/facebook-connect", [4]],
  ["/dashboard/after-live", [4]],
  ["/dashboard/showing-agents", [5, 8]],
  ["/dashboard/showings", [6]],
  ["/dashboard/automations", [7]],
  ["/dashboard/settings/notifications", [7]],
  ["/dashboard/tenancies/", [10, 9]],
  ["/dashboard/tenancies", [10]],
  ["/dashboard/tenants", [10, 9]],
  // S816: Leasing overview and Reports are about renters and viewings, not
  // after the lease (Noam: the "?" sometimes opened the wrong video).
  ["/dashboard/leasing", [3, 6]],
  ["/dashboard/rent", [10]],
  ["/dashboard/money", [10]],
  ["/dashboard/maintenance", [10]],
  ["/dashboard/expenses", [10]],
  ["/dashboard/reports", [6, 3]],
];

// The Today page itself (exact /dashboard only): replies and follow-ups.
const HOME_VIDEOS = [3, 6];

export type HelpVideo = (typeof HOW_TO_VIDEOS)[number];

/** The videos for a page, most useful first; [] means show the full list. */
export function helpVideosFor(pathname: string | null | undefined): HelpVideo[] {
  const p = (pathname ?? "").split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (p === "/dashboard") return HOME_VIDEOS.map((n) => HOW_TO_VIDEOS.find((v) => v.n === n)!).filter(Boolean);
  for (const [prefix, nums] of PAGE_HELP_ROUTES) {
    const hit = prefix.endsWith("/") ? p.startsWith(prefix) && p.length > prefix.length : p === prefix || p.startsWith(prefix + "/");
    if (hit) return nums.map((n) => HOW_TO_VIDEOS.find((v) => v.n === n)!).filter(Boolean);
  }
  return [];
}
