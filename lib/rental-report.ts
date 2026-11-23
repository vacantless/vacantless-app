// S831: the per-rental monthly report (Noam's ask, styled after his
// "Suite 503 - marketing update and next steps" email to an owner).
// Three sections in the same order: Latest work and next steps, Response so
// far, Marketing to date. Every number comes from our own records and carries
// a plain caveat; nothing is guessed. Pure and tested in
// scripts/test-s831-rental-report.ts; the sweep is app/api/cron/rental-report.
import { portalLabel } from "@/lib/listing-distribution";

export type ReportPost = { portal: string | null; status: string | null; url: string | null; createdAt: string | null };
export type ReportCost = { portal: string | null; label: string | null; amountCents: number; spentOn: string };
export type ReportLead = { source: string | null; createdAt: string };
export type ReportShowing = { scheduledAt: string; outcome: string | null };

export type RentalReportInput = {
  address: string | null;
  rentCents: number | null;
  /** First day of the reported month, YYYY-MM-DD (Toronto). */
  monthStart: string;
  /** First day of the next month, YYYY-MM-DD (exclusive end). */
  monthEnd: string;
  /** Today, YYYY-MM-DD (Toronto). Days on market count to here. */
  today: string;
  availableSince: string | null;
  posts: readonly ReportPost[];
  /** Costs tied to this rental, all dates. */
  costs: readonly ReportCost[];
  /** Account-wide costs (no rental) spent in the reported month, in cents. */
  accountWideMonthCents: number;
  leads: readonly ReportLead[];
  showings: readonly ReportShowing[];
  nextSteps: string | null;
  rentalUrl: string;
  /** The rental's public Vacantless page (photos, details, booking). */
  pageUrl?: string | null;
  /** The landlord books viewings themselves (S828c); none recorded is not news. */
  viewingsByRequest?: boolean;
  orgName: string | null;
};

export type RentalReport = {
  subject: string;
  html: string;
  text: string;
  /** Nothing to say (no ad and no renter ever): do not send. */
  empty: boolean;
  /** Numbers, for the dry run and the test. */
  facts: {
    rentersMonth: number;
    rentersToDate: number;
    bookedMonth: number;
    heldMonth: number;
    noShowMonth: number;
    daysOnMarket: number | null;
    spentMonthCents: number;
    spentToDateCents: number;
    liveSites: string[];
  };
};

const SITE_ORDER = ["vacantless", "kijiji", "facebook", "zumper", "rentals_ca", "padmapper", "facebook_feed"];

export function dollars(cents: number): string {
  const v = Math.round(cents) / 100;
  return `$${v.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1] : null;
}

function inMonth(day: string | null, start: string, end: string): boolean {
  return !!day && day >= start && day < end;
}

function niceDate(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-CA", { month: "long", day: "numeric", timeZone: "UTC" });
}

export function monthName(monthStart: string): string {
  const [y, m] = monthStart.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
}

function daysBetween(a: string, b: string): number {
  return Math.max(0, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000));
}

export function shortAddr(address: string | null): string {
  if (!address) return "your rental";
  // "50 Glenrose Ave, Unit B, Toronto, ON" -> "50 Glenrose Ave, Unit B"
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2 && /^(unit|suite|apt|#)/i.test(parts[1])) return `${parts[0]}, ${parts[1]}`;
  return parts[0] ?? address;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function words(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function siteName(key: string | null): string {
  if (key === "vacantless") return "Your Vacantless page";
  return portalLabel(key);
}

type Para = { kind: "p"; text: string; html: string } | { kind: "li"; items: { text: string; html: string }[] };

export function buildRentalReport(input: RentalReportInput): RentalReport {
  const { monthStart: ms, monthEnd: me, today } = input;
  const month = monthName(ms);
  const where = shortAddr(input.address);

  // ---- marketing (live sites, one line each, site order) ----
  const live = input.posts.filter((p) => p.status === "live" && (p.url ?? "").trim());
  const bySite = new Map<string, ReportPost>();
  for (const p of live) {
    const k = p.portal ?? "other";
    const cur = bySite.get(k);
    if (!cur || (dayOf(p.createdAt) ?? "") < (dayOf(cur.createdAt) ?? "")) bySite.set(k, p);
  }
  const siteKeys = Array.from(bySite.keys()).sort(
    (a, b) => (SITE_ORDER.indexOf(a) + 99) % 99 - (SITE_ORDER.indexOf(b) + 99) % 99,
  );
  const costBySite = new Map<string, number>();
  for (const c of input.costs) costBySite.set(c.portal ?? "other", (costBySite.get(c.portal ?? "other") ?? 0) + c.amountCents);

  const spentToDate = input.costs.reduce((s, c) => s + c.amountCents, 0);
  const spentMonth = input.costs.filter((c) => inMonth(c.spentOn, ms, me)).reduce((s, c) => s + c.amountCents, 0);

  // ---- response ----
  const leadsMonth = input.leads.filter((l) => inMonth(dayOf(l.createdAt), ms, me));
  const srcCount = new Map<string, number>();
  for (const l of leadsMonth) {
    const s = (l.source ?? "").trim() || "Other";
    const label = s === "website" ? "your Vacantless page" : s;
    srcCount.set(label, (srcCount.get(label) ?? 0) + 1);
  }
  const srcList = Array.from(srcCount.entries()).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} from ${k}`);
  const showMonth = input.showings.filter((s) => inMonth(dayOf(s.scheduledAt), ms, me) && s.outcome !== "cancelled");
  const held = showMonth.filter((s) => s.outcome === "attended").length;
  const noShow = showMonth.filter((s) => s.outcome === "no_show").length;

  const firstLive = live.map((p) => dayOf(p.createdAt)).filter(Boolean).sort()[0] ?? null;
  const since = dayOf(input.availableSince) ?? firstLive;
  const dom = since && since <= today ? daysBetween(since, today) : null;

  const empty = live.length === 0 && input.leads.length === 0;

  // ---- section 1: latest work ----
  const work: { text: string; html: string }[] = [];
  const wentLive = live
    .filter((p) => inMonth(dayOf(p.createdAt), ms, me))
    .sort((a, b) => (dayOf(a.createdAt) ?? "").localeCompare(dayOf(b.createdAt) ?? ""));
  for (const p of wentLive) {
    const t = `${siteName(p.portal)} ad went live on ${niceDate(dayOf(p.createdAt) as string)}.`;
    work.push({ text: t, html: esc(t) });
  }
  const paidMonth = input.costs.filter((c) => inMonth(c.spentOn, ms, me));
  for (const c of paidMonth) {
    const t = `Paid ${dollars(c.amountCents)} for ${c.label?.trim() || siteName(c.portal)} on ${niceDate(c.spentOn)}.`;
    work.push({ text: t, html: esc(t) });
  }

  const out: { heading: string; paras: Para[] }[] = [];
  const s1: Para[] = [];
  if (work.length) s1.push({ kind: "li", items: work });
  else s1.push({ kind: "p", text: `No new ads went up in ${month}; the ads below kept running.`, html: esc(`No new ads went up in ${month}; the ads below kept running.`) });
  const note = (input.nextSteps ?? "").trim();
  if (note) {
    s1.push({ kind: "p", text: `Next steps: ${note}`, html: `<strong>Next steps:</strong> ${esc(note).replace(/\n/g, "<br>")}` });
  }
  out.push({ heading: "Latest work and next steps", paras: s1 });

  // ---- section 2: response so far ----
  const s2: Para[] = [];
  const rentersLine =
    leadsMonth.length === 0
      ? `No renters wrote in during ${month}. ${input.leads.length} in total since the ads went up.`
      : `${leadsMonth.length} ${leadsMonth.length === 1 ? "renter" : "renters"} wrote in during ${month} (${words(srcList)}), ${input.leads.length} in total since the ads went up. Some only ask a quick question, so this is not a count of qualified applicants.`;
  s2.push({ kind: "p", text: rentersLine, html: esc(rentersLine).replace(/^(\d+ renters?|No renters)/, "<strong>$1</strong>") });
  const vLine =
    showMonth.length === 0
      ? `No viewings were booked for ${month}.`
      : `${showMonth.length} ${showMonth.length === 1 ? "viewing was" : "viewings were"} booked for ${month}: ${held} held, ${noShow} no-show${noShow === 1 ? "" : "s"}${showMonth.length - held - noShow > 0 ? `, ${showMonth.length - held - noShow} not marked yet` : ""}.`;
  if (!(input.viewingsByRequest && showMonth.length === 0)) s2.push({ kind: "p", text: vLine, html: esc(vLine) });
  if (dom !== null && since) {
    const d = `On the market ${dom} ${dom === 1 ? "day" : "days"}, counted from ${niceDate(since)}.`;
    s2.push({ kind: "p", text: d, html: esc(d) });
  }
  out.push({ heading: "Response so far", paras: s2 });

  // ---- section 3: marketing to date ----
  const s3: Para[] = [];
  const items: { text: string; html: string }[] = [];
  if (input.pageUrl && live.length > 0) {
    const t = "Rental page with all photos and details:";
    items.push({ text: `${t} ${input.pageUrl}`, html: `${esc(t)} <a href="${esc(input.pageUrl)}">View the page</a>` });
  }
  for (const k of siteKeys) {
    const p = bySite.get(k) as ReportPost;
    const d = dayOf(p.createdAt);
    const cost = costBySite.get(k);
    const costWords = cost ? `${dollars(cost)} spent` : "no cost entered";
    const t = `${siteName(k)}: live since ${d ? niceDate(d) : "earlier"}, ${costWords}.`;
    const url = (p.url ?? "").trim();
    items.push({ text: `${t} ${url}`, html: `${esc(t)} <a href="${esc(url)}">View the ad</a>` });
  }
  if (items.length) s3.push({ kind: "li", items });
  else s3.push({ kind: "p", text: "No ads are live right now.", html: "No ads are live right now." });
  let money = `Spent in ${month}: ${dollars(spentMonth)}. Spent to date: ${dollars(spentToDate)}.`;
  if (input.accountWideMonthCents > 0) money += ` Plus ${dollars(input.accountWideMonthCents)} in ${month} for the whole account, not tied to one rental.`;
  s3.push({ kind: "p", text: money, html: `<strong>${esc(money.split(". ")[0])}.</strong> ${esc(money.split(". ").slice(1).join(". "))}` });
  out.push({ heading: "Marketing to date", paras: s3 });

  const intro = `Here's the ${month} update on ${where}: the latest work, the response so far and a recap of the marketing.`;
  const foot = "Paid for an ad that shows no cost? Add it in Reports, under What each site costs you, and pick this rental. This report is built from your Vacantless records, so you can forward it to the owner as it is.";

  // ---- render ----
  const textParts: string[] = [intro];
  const htmlParts: string[] = [`<p>${esc(intro)}</p>`];
  for (const sec of out) {
    textParts.push(sec.heading.toUpperCase());
    htmlParts.push(`<p style="margin-top:22px;margin-bottom:8px"><strong>${esc(sec.heading)}</strong></p>`);
    for (const p of sec.paras) {
      if (p.kind === "p") {
        textParts.push(p.text);
        htmlParts.push(`<p>${p.html}</p>`);
      } else {
        textParts.push(p.items.map((i) => `- ${i.text}`).join("\n"));
        htmlParts.push(`<ul style="padding-left:22px;margin-top:0">${p.items.map((i) => `<li style="margin-bottom:8px">${i.html}</li>`).join("")}</ul>`);
      }
    }
  }
  textParts.push(foot);
  htmlParts.push(`<p style="font-size:13px;color:#666;margin-top:22px">${esc(foot)}</p>`);
  htmlParts.push(`<p style="text-align:center;margin:22px 0"><a href="${esc(input.rentalUrl)}" style="display:inline-block;background:#1f3d2b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">Open this rental</a></p>`);
  textParts.push(`Open this rental: ${input.rentalUrl}`);

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:640px">${htmlParts.join("\n")}</div>`;

  return {
    subject: `${where} - ${month} marketing update and next steps`,
    html,
    text: textParts.join("\n\n"),
    empty,
    facts: {
      rentersMonth: leadsMonth.length,
      rentersToDate: input.leads.length,
      bookedMonth: showMonth.length,
      heldMonth: held,
      noShowMonth: noShow,
      daysOnMarket: dom,
      spentMonthCents: spentMonth,
      spentToDateCents: spentToDate,
      liveSites: siteKeys,
    },
  };
}

/** The month to report on, from a Toronto calendar day: the month before it. */
export function reportMonthFor(torontoToday: string): { monthStart: string; monthEnd: string; key: string } {
  const [y, m] = torontoToday.split("-").map(Number);
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  return { monthStart: `${prevY}-${pad(prevM)}-01`, monthEnd: `${y}-${pad(m)}-01`, key: `${prevY}-${pad(prevM)}` };
}

/** "Send now" covers the current month so far. */
export function currentMonthFor(torontoToday: string): { monthStart: string; monthEnd: string; key: string } {
  const [y, m] = torontoToday.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return { monthStart: `${y}-${pad(m)}-01`, monthEnd: `${nextY}-${pad(nextM)}-01`, key: `${y}-${pad(m)}` };
}

/**
 * S836a (REVIEW-S835 finding 11): what one rental's monthly send came to.
 * "failed": nobody got it, so the sweep hands the month back and the next
 * 15-minute run on the 1st tries again. "partial": someone got it, so the
 * month stays claimed (no one gets it twice) but the run still says so.
 * "no_recipient": nobody to send to, nothing to retry. Pure.
 */
export type ReportSendOutcome = "sent" | "partial" | "failed" | "no_recipient";
export function reportSendOutcome(recipients: number, sent: number): ReportSendOutcome {
  if (recipients <= 0) return "no_recipient";
  if (sent <= 0) return "failed";
  if (sent < recipients) return "partial";
  return "sent";
}
