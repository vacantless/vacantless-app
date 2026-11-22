// S737 (review item 2): the email that follows the results card. The card
// shows only while the landlord is on the page; this sends the same list to
// their inbox once the first ads have settled, so they can share it.
// Pure and tested in scripts/test-posted-results-email.ts; the sweep is
// app/api/cron/posted-results-email.
import { postedResultsSites, type PostedResultsNext } from "@/lib/posted-results";
import { publicAdUrl } from "@/lib/rental-list-view";
import { shortAddress } from "@/lib/posting-coverage";

/** Wait this long after the first live ad, so the other sites can catch up. */
export const RESULTS_EMAIL_WAIT_MS = 2 * 60 * 60 * 1000;
/** Never email about a rental that went live longer ago than this. */
export const RESULTS_EMAIL_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export type ResultsEmailPost = {
  portal: string | null;
  status: string | null;
  url: string | null;
  createdAt: string | null;
};

/**
 * "send" once per turn, "wait" while the first ads are fresh, else "none".
 * A turn begins at the oldest ad that is live now.
 */
export function resultsEmailDecision(args: {
  propertyStatus: string | null;
  posts: readonly ResultsEmailPost[];
  lastSentAt: string | null;
  now: number;
}): "send" | "wait" | "none" {
  if (args.propertyStatus !== "available") return "none";
  const live = args.posts.filter((p) => p.status === "live" && (p.url ?? "").trim() && p.createdAt);
  if (live.length === 0) return "none";
  const turnStart = Math.min(...live.map((p) => Date.parse(p.createdAt as string)));
  if (!Number.isFinite(turnStart)) return "none";
  const last = args.lastSentAt ? Date.parse(args.lastSentAt) : NaN;
  if (Number.isFinite(last) && last >= turnStart) return "none";
  const age = args.now - turnStart;
  if (age > RESULTS_EMAIL_MAX_AGE_MS) return "none";
  if (age < RESULTS_EMAIL_WAIT_MS) return "wait";
  return "send";
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * S829 (Noam's read of the 251 Manitoba email): the count is rental sites
 * only (the Vacantless page is not a site), the address is short, the page
 * link appears once, the viewing line matches how the landlord books, and the
 * next step rides the button instead of a second long link.
 */
export function resultsEmail(input: {
  address: string | null;
  posts: readonly ResultsEmailPost[];
  bookingUrl: string;
  appUrl: string;
  nextStep: PostedResultsNext | null;
  /** organizations.viewings_by_request (S828c): the landlord books each viewing. */
  viewingsByRequest?: boolean;
  /** The rental's own page, the button when there is no next step. */
  rentalHref?: string;
}): { subject: string; body: string; actionLabel: string; actionHref: string | null } {
  const sites = postedResultsSites(input.posts);
  const where = input.address ? shortAddress(input.address) : "Your rental";
  const names = sites.map((s) => s.label);
  const headline =
    sites.length === 0
      ? `${where} is live`
      : sites.length === 1
        ? `${where} is live on ${names[0]}`
        : `${where} is live on ${sites.length} rental sites`;
  const lines = [
    sites.length > 1 ? `${where} is live on ${listWords(names)}.` : `${headline}.`,
    "",
    // S828: the ad a renter sees. Zumper saves the owner's manage link, which
    // asks for a Zumper sign-in (S773 fixed this on the Rentals list only).
    ...sites.map((s) => `${s.label}: ${publicAdUrl(s.key, s.url)}`),
    ...(sites.length > 0 ? [""] : []),
    `Your Vacantless page, to send anyone who asks: ${input.bookingUrl}`,
    "",
    "Renters who write on a site show up in Renters.",
    "Our reply sends them to your page.",
    input.viewingsByRequest
      ? "They ask for a viewing, and you choose who to show it to."
      : "They book a viewing there, or ask for one when no times are open.",
  ];
  let actionLabel = "Open your rental";
  let actionHref: string | null = input.rentalHref ?? null;
  if (input.nextStep) {
    const href = input.nextStep.href.startsWith("http") ? input.nextStep.href : `${input.appUrl}${input.nextStep.href}`;
    actionHref = href;
    if (input.nextStep.key === "marketplace") {
      // S828: Vacantless only knows a Marketplace ad once its link is saved,
      // so "Add Marketplace" reached a landlord whose ad was already up
      // (50 Glenrose B). Say both cases.
      lines.push(
        "",
        "Not on Facebook Marketplace yet? It is free, and most renters look there first.",
        "Already posted it? Paste the ad's link on the rental, so we track it.",
      );
      actionLabel = "Post to Marketplace";
    } else {
      lines.push("", `Want more renters? Add ${input.nextStep.title}.`);
      actionLabel = `Add ${input.nextStep.title}`;
    }
  }
  return {
    subject: headline,
    body: lines.join("\n"),
    actionLabel,
    actionHref,
  };
}
