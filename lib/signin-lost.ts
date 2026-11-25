// S736: the email a landlord gets when Kijiji, Zumper or Rentals.ca signs them
// out (worker session check: alive=false, needs_login). Without it, posting to
// that site stopped quietly until they looked at the site tiles. Pure, tested
// in scripts/test-signin-lost.ts; the 15-minute sweep is
// app/api/cron/signin-lost.

import { OPT_OUT_LINE } from "./sms";

export const SIGNIN_LOST_CODES = ["needs_login", "no_session"] as const;

export type SigninLostRow = {
  alive: boolean | null;
  lastCheckCode: string | null;
  lostNotifiedAt: string | null;
};

/** "notify" once per sign-out, "clear" once it works again, else nothing. Pure. */
export function signinLostAction(row: SigninLostRow): "notify" | "clear" | "none" {
  const lost = row.alive === false && (SIGNIN_LOST_CODES as readonly string[]).includes(row.lastCheckCode ?? "");
  if (lost) return row.lostNotifiedAt ? "none" : "notify";
  if (row.alive === true && row.lostNotifiedAt) return "clear";
  return "none";
}

/** "Zumper", "Zumper and Rentals.ca", "Kijiji, Rentals.ca and Zumper". */
export function joinAnd(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * S841d (REVIEW-S841): one email for every site that needs a sign-in, sent
 * only when something is waiting there. `sites` are signed out with work
 * waiting; `canWait` are signed out with nothing waiting; `dueSoon` still work
 * but are late in a sign-in that usually ends soon (lines from dueSoonLine).
 */
export function signinLostGroupEmail(input: {
  orgName: string | null;
  sites: readonly { label: string; waiting: string }[];
  canWait?: readonly string[];
  dueSoon?: readonly string[];
}): { subject: string; body: string; actionLabel: string } {
  const names = input.sites.map((s) => s.label);
  const all = joinAnd(names);
  const several = names.length + (input.dueSoon?.length ?? 0) > 1;
  const lines: string[] = [];
  lines.push(`${all} signed ${input.orgName || "your account"} out.`);
  for (const s of input.sites) lines.push(`On ${s.label}, ${s.waiting}. That waits until you sign in.`);
  lines.push("Your other sites keep working.");
  if (input.dueSoon && input.dueSoon.length > 0) {
    lines.push("");
    lines.push("Worth doing in the same sitting:");
    for (const l of input.dueSoon) lines.push(l);
  }
  if (input.canWait && input.canWait.length > 0) {
    lines.push("");
    lines.push(
      `${joinAnd(input.canWait)} signed out too, but nothing is waiting there and your ads stay up. Skip ${input.canWait.length === 1 ? "it" : "them"} for now if you like. We will ask when an ad is waiting.`,
    );
  }
  lines.push("");
  lines.push(
    several
      ? "Press the button below and sign in to each, one after the other. About 2 minutes a site."
      : "Press the button below and sign in. It takes about a minute.",
  );
  return {
    subject: `Sign in to ${all} again`,
    body: lines.join("\n"),
    actionLabel: several ? `Sign in to ${names[0]} first` : `Sign in to ${names[0]}`,
  };
}

export function signinLostEmail(input: { siteLabel: string; orgName: string | null }): {
  subject: string;
  body: string;
  actionLabel: string;
} {
  const site = input.siteLabel;
  return {
    subject: `Sign in to ${site} again`,
    body:
      `${site} signed ${input.orgName || "your account"} out.\n` +
      `Until you sign in again, we cannot post your rentals on ${site}.\n` +
      "Your other sites keep working.\n\n" +
      "Press the button below and sign in. It takes about a minute.",
    actionLabel: `Sign in to ${site}`,
  };
}

// ---------------------------------------------------------------------------
// S762 (REVIEW-S761 item 3): the same news by text, for Growth landlords who
// saved their own mobile in Settings and have texting on. Once per sign-out
// (lost_texted_at), never in quiet hours (it waits for the morning), cleared
// with the email stamp once the session works again.
// ---------------------------------------------------------------------------

export type SigninLostTextRow = {
  alive: boolean | null;
  lastCheckCode: string | null;
  lostTextedAt: string | null;
  /** The landlord's own mobile, E.164, or null. */
  alertMobile: string | null;
  /** Plan includes texts (Growth and up) and the account turned texting on. */
  textsOn: boolean;
  /** Now is inside quiet hours in the account's time zone. */
  quiet: boolean;
};

/** "text" now, "wait" for the morning, "clear" once it works again, else nothing. Pure. */
export function signinLostTextAction(row: SigninLostTextRow): "text" | "wait" | "clear" | "none" {
  const lost = row.alive === false && (SIGNIN_LOST_CODES as readonly string[]).includes(row.lastCheckCode ?? "");
  if (!lost) return row.alive === true && row.lostTextedAt ? "clear" : "none";
  if (row.lostTextedAt || !row.alertMobile || !row.textsOn) return "none";
  return row.quiet ? "wait" : "text";
}

export function signinLostText(input: { siteLabel: string; url: string }): string {
  return (
    `Vacantless: ${input.siteLabel} signed you out, so your ads there stopped posting. ` +
    `Sign in again, about 2 minutes: ${input.url} ${OPT_OUT_LINE}`
  );
}
