// ============================================================================
// for-you-row-state (S762). One site row's state on the Get online tab, pure.
//
// Until S762 this lived inside the ForYouRow component, so the green card's
// headline could not say which sites need the landlord without a second copy
// of the rules (r353: a count beside a list counts the list). The row and the
// headline now read the same function: one word (On, Posting, Needs you, or
// the add-on chip) and the flags the row's body branches on.
// ============================================================================

import { forYouLiveState } from "./publish-everywhere";
import { isRobotPostedChannel } from "./posting-lanes";

export type ForYouRowItem = {
  mode: string;
  publishStatus: string;
  checkoutUrl?: string | null;
  approved?: boolean;
  siteSetup?: { message: string; href: string; action: string } | null;
  externalUrl: string | null;
  /** S785: another Rentals.ca ad is being switched off for this one; nothing for the landlord to do. */
  waitingForSlot?: boolean;
  /** S786: "I paid" pressed and the worker is saving the link. */
  paidPressed?: boolean;
  /** S786: the worker could not save the paid ad's link (the landlord has a step). */
  captureNote?: string | null;
};

export type ForYouRowStateInput = {
  rowKey: string;
  item: ForYouRowItem | null;
  liveProofUrl: string | null;
  retiredUrls: readonly string[];
  alreadySignedIn: boolean | undefined;
  addonLocked: boolean;
  postingBlocked: boolean;
  hasMarketplaceKit: boolean;
};

export type ForYouRowWord = "On" | "Posting" | "Needs you" | "addon";

export type ForYouRowState = {
  isLive: boolean;
  liveUrl: string | null;
  gate: string | null;
  postingBlocked: boolean;
  payAtCheckout: boolean;
  approvedRunning: boolean;
  needsApproval: boolean;
  siteSetup: { message: string; href: string; action: string } | null;
  needsConnect: boolean;
  repostable: boolean;
  working: boolean;
  preparing: boolean;
  locked: boolean;
  signinFirst: boolean;
  word: ForYouRowWord;
};

export function forYouRowState(input: ForYouRowStateInput): ForYouRowState {
  const item = input.item;
  // S712: Marketplace needs no sign-in, fee or square footage, so the "finish
  // your listing first" hold does not apply; its kit warns when photos are missing.
  const postingBlocked = input.postingBlocked && !input.hasMarketplaceKit;
  const { isLive, liveUrl } = forYouLiveState({
    runItem: item,
    liveProofUrl: input.liveProofUrl,
    retiredUrls: input.retiredUrls,
  });
  const gate = item != null && item.mode === "concierge" ? item.publishStatus : null;
  // S708: the robot built a paid ad and stopped at the site's checkout.
  const payAtCheckout = !isLive && gate === "needs_payment" && !!item?.checkoutUrl;
  // S724 (V251-33): once approved, the item is the robot's until it finishes.
  const approvedRunning =
    !isLive &&
    !payAtCheckout &&
    item?.approved === true &&
    (gate === "needs_operator" || gate === "needs_payment");
  const needsApproval =
    !isLive &&
    !payAtCheckout &&
    !approvedRunning &&
    (gate === "needs_operator" || gate === "needs_payment");
  // S713d: the robot found a step only the landlord can do on the site itself.
  const siteSetup = needsApproval ? (item?.siteSetup ?? null) : null;
  const needsConnect = !isLive && gate === "needs_login";
  // S703/S708: a stale live or a rejected item is offered as a fresh post.
  const repostable =
    !isLive && item != null && (item.publishStatus === "live" || item.publishStatus === "rejected");
  const working =
    !isLive &&
    (approvedRunning || gate === "queued" || gate === "submitting" || gate === "submitted");
  // S719/S724: before Approve the robot is only building the ad.
  const preparing =
    working &&
    (gate === "queued" || gate === "submitting" || gate === "submitted") &&
    item?.approved !== true &&
    isRobotPostedChannel(input.rowKey);
  const locked = input.addonLocked && !isLive;
  // S760: a robot site with no sign-in yet.
  const signinFirst =
    !isLive &&
    !locked &&
    isRobotPostedChannel(input.rowKey) &&
    input.alreadySignedIn !== true &&
    !(working || payAtCheckout || needsApproval || needsConnect);

  // S760 (REVIEW-S760 section 4): one of four words.
  const word: ForYouRowWord = isLive
    ? "On"
    : locked
      ? "addon"
      : postingBlocked
        ? "Posting"
        : item?.waitingForSlot === true
          ? "Posting"
        : payAtCheckout && item?.paidPressed === true && !item?.captureNote
          ? "Posting"
        : payAtCheckout || siteSetup || needsApproval || needsConnect || signinFirst || repostable
          ? "Needs you"
          : preparing || working
            ? "Posting"
            : input.alreadySignedIn === true && isRobotPostedChannel(input.rowKey) && item != null
              ? "Posting"
              : "Needs you";
  // S770 (REVIEW-S770 section 3 item 1): signed in but nothing queued means the
  // row shows a "Post here" button, so the word is "Needs you", not "Posting".
  // Before S770 Assumption 9 read "Posting" above a "Post here" button.

  return {
    isLive,
    liveUrl,
    gate,
    postingBlocked,
    payAtCheckout,
    approvedRunning,
    needsApproval,
    siteSetup,
    needsConnect,
    repostable,
    working,
    preparing,
    locked,
    signinFirst,
    word,
  };
}

/** "Kijiji needs you." / "Kijiji and Zumper need you." / "Kijiji, Zumper and Rentals.ca need you." Pure. */
export function needsYouSentence(labels: string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return `${labels[0]} needs you.`;
  const head = labels.slice(0, -1).join(", ");
  return `${head} and ${labels[labels.length - 1]} need you.`;
}
