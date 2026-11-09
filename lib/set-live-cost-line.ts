// S771 (REVIEW-S770 section 4): the cost and free-listing line before Set Live.
//
// Since S761, Set Live also queues the robot on every connected site, but the
// confirm only listed the instant destinations (the Facebook Page). A landlord
// with 12 units pressed Set Live without reading that Kijiji charges for every
// ad after the first or that Rentals.ca was at 2 of 3 free listings. The pieces
// were on each site row; nothing summed them before the click.
//
// Pure: one short note per robot site from the tile's cost and cap verdict
// (lib/distribution-channels channelCostCap), and the one sentence above them.

import { CHANNEL_COST_CENTS, formatChannelMoney, type ChannelCostCap } from "./distribution-channels";
import { SITE_SIGNIN_LABEL, type SiteSigninChannel } from "./site-signin";

export type SetLiveSiteNote = { key: SiteSigninChannel; label: string; note: string; paid: boolean; capReached: boolean };

export function setLiveSiteNote(channel: SiteSigninChannel, cc: ChannelCostCap): SetLiveSiteNote {
  const label = SITE_SIGNIN_LABEL[channel];
  const base = { key: channel, label, paid: false, capReached: cc.capReached };
  const price = (cents: number | null | undefined) => formatChannelMoney(typeof cents === "number" ? cents : CHANNEL_COST_CENTS.kijiji ?? 0);
  const cost = cc.cost?.key;
  if (channel === "kijiji") {
    if (cost === "kijijiPerAd" || cost === "kijijiPerExtraAd") {
      return { ...base, paid: true, note: `${price(cc.cost?.priceCents)}, you pay Kijiji at checkout.` };
    }
    if (cost === "kijijiNext") return { ...base, note: "Uses your 1 free ad." };
    return { ...base, note: `Free if it is your first ad, otherwise ${price(cc.cost?.priceCents)} at checkout.` };
  }
  const cap = cc.cap;
  const total = channel === "rentals_ca" ? 3 : 5;
  if (cap && (cap.key === "rentalsReached" || cap.key === "zumperReached")) {
    return { ...base, note: `All ${total} free listings are in use. Take one down first.` };
  }
  if (cap && typeof cap.used === "number") return { ...base, note: `Free. ${cap.used} of ${total} free listings used.` };
  return { ...base, note: `Free for up to ${total} listings.` };
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** "This rental will also post to Kijiji, Rentals.ca and Zumper on your own accounts." */
export function setLiveSitesSentence(notes: readonly SetLiveSiteNote[]): string | null {
  if (notes.length === 0) return null;
  const s = `This rental will also post to ${joinLabels(notes.map((n) => n.label))} on your own accounts.`;
  const paid = notes.filter((n) => n.paid).map((n) => n.label);
  // A paid Kijiji ad is past its free one but still posts; "full" is a site that will refuse.
  const full = notes.filter((n) => n.capReached && !n.paid).map((n) => n.label);
  const extra: string[] = [];
  if (paid.length) extra.push(`${joinLabels(paid)} ${paid.length > 1 ? "charge" : "charges"} for this ad.`);
  if (full.length) extra.push(`${joinLabels(full)} ${full.length > 1 ? "have" : "has"} no free listing left.`);
  return extra.length ? `${s} ${extra.join(" ")}` : s;
}
