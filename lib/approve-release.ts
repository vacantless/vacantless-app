// S829: when approving a paid post parked at needs_payment, decide whether it
// goes back to the robot's queue. The robot only picks up needs_operator. A
// post the robot already built to a site's checkout keeps its checkout link
// for the landlord to pay. A post with no link, or a link that is only the
// site's empty post form (Kijiji's p-post-ad.html, saved when the robot
// stopped on the plan wall), was never built: it goes back to the robot.
// Glenrose 2026-11-22: the approval sat at needs_payment because the saved
// link was the post form.
// S829c: "built" is exactly what siteCheckoutUrl calls a checkout. A Kijiji
// checkout is p-post-ad.html?addToCart=true (S709, KI1263); S829a's first
// version treated that as a bare form and would have re-posted a built ad.
import { siteCheckoutUrl } from "./distribution-publish";

export function isBareSitePostForm(url: string | null | undefined): boolean {
  if (!url) return false;
  return siteCheckoutUrl("needs_payment", url) == null;
}

export function shouldReleaseToRobot(item: {
  publish_status: string | null | undefined;
  operator_action_url?: string | null;
}): boolean {
  if (item.publish_status !== "needs_payment") return false;
  return siteCheckoutUrl("needs_payment", item.operator_action_url ?? null) == null;
}
