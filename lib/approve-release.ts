// S829: when approving a paid post parked at needs_payment, decide whether it
// goes back to the robot's queue. The robot only picks up needs_operator. A
// post the robot already built to a site's checkout keeps its checkout link
// for the landlord to pay. A post with no link, or a link that is only the
// site's empty post form (Kijiji's p-post-ad.html, saved when the robot
// stopped on the plan wall), was never built: it goes back to the robot.
// Glenrose 2026-11-22: the approval sat at needs_payment because the saved
// link was the post form.

const POST_FORM_URL_RE = /kijiji\.ca\/p-post-ad\.html/i;

export function isBareSitePostForm(url: string | null | undefined): boolean {
  if (!url) return false;
  return POST_FORM_URL_RE.test(url);
}

export function shouldReleaseToRobot(item: {
  publish_status: string | null | undefined;
  operator_action_url?: string | null;
}): boolean {
  if (item.publish_status !== "needs_payment") return false;
  if (!item.operator_action_url) return true;
  return isBareSitePostForm(item.operator_action_url);
}
