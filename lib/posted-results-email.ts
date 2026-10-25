// S737 (review item 2): the email that follows the results card. The card
// shows only while the landlord is on the page; this sends the same list to
// their inbox once the first ads have settled, so they can share it.
// Pure and tested in scripts/test-posted-results-email.ts; the sweep is
// app/api/cron/posted-results-email.
import { postedResultsSites, type PostedResultsNext } from "@/lib/posted-results";

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

export function resultsEmail(input: {
  address: string | null;
  posts: readonly ResultsEmailPost[];
  bookingUrl: string;
  appUrl: string;
  nextStep: PostedResultsNext | null;
}): { subject: string; body: string; actionLabel: string } {
  const sites = postedResultsSites(input.posts);
  const where = input.address || "Your rental";
  const count = sites.length + 1;
  const headline = count === 1 ? `${where} is live` : `${where} is live on ${count} sites`;
  const lines = [
    `${headline}.`,
    "",
    `Your Vacantless page: ${input.bookingUrl}`,
    ...sites.map((s) => `${s.label}: ${s.url}`),
    "",
    "Every ad points renters to your booking link.",
    `Send it to anyone who asks: ${input.bookingUrl}`,
    "",
    "A renter writes on any of these sites.",
    "They show up in Renters, and our reply carries your booking link.",
    "Renters pick a viewing time themselves.",
  ];
  if (input.nextStep) {
    const href = input.nextStep.href.startsWith("http") ? input.nextStep.href : `${input.appUrl}${input.nextStep.href}`;
    lines.push("", `Want more renters? Add ${input.nextStep.title}.`, href);
  }
  return {
    subject: headline,
    body: lines.join("\n"),
    actionLabel: "Open your rental",
  };
}
