// S845: what marking a rental rented does to each ad, shown BEFORE the press
// (Noam, 2026-11-26: "setting to leased should give a warning and then take
// down all ads"). Pure. The robot rule is lib/robot-takedown's own, so the
// warning and the takedown can never disagree. Tests: scripts/test-s845-mark-rented.ts.
import { handReason, siteName } from "@/lib/ads-still-up";
import { robotTakedownTargets } from "@/lib/robot-takedown";

export type RentedPlanLine = { postId: string; site: string; byUs: boolean; line: string };

export function rentedPlan(input: {
  posts: { id: string; portal: string; status: string | null; url: string | null }[];
  aliveChannels: readonly string[];
  postingAllowed: boolean;
}): RentedPlanLine[] {
  const robot = new Set(robotTakedownTargets(input).map((t) => t.id));
  return input.posts
    .filter((p) => p.status === "live" && !!p.url?.trim())
    .map((p) => {
      const byUs = robot.has(p.id) || p.portal === "facebook_feed";
      return {
        postId: p.id,
        site: siteName(p.portal),
        byUs,
        line: byUs ? "We take this ad down for you." : `You delete this one. ${handReason(p.portal, false)}`,
      };
    });
}
