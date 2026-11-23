// S836b: the monthly account summary. Noam 2026-11-23 asked for the questions
// an owner asks: what's my vacancy rate, how many units rented or on the
// market and for how long, how much have we spent and should we spend
// differently, income vs expenses, and how many inquiries and showings each
// unit had. One email per account on the 1st (next to the per-rental reports)
// and the same page on Reports. Pure and tested in
// scripts/test-s836b-account-report.ts. Every number comes from our own
// records; where we have none, it says so instead of showing $0.
import { buildChannelReport, type LeadLite } from "@/lib/reports";
import { buildCostAdvice, buildSiteCosts, dollars, type CostLite, type SiteCostRow } from "@/lib/channel-costs";
import { monthName, shortAddr } from "@/lib/rental-report";

export type AccountProperty = {
  id: string;
  address: string | null;
  status: string | null;
  availableSince: string | null;
};
export type AccountOutcome = {
  propertyId: string | null;
  address: string | null;
  availableSince: string | null;
  leasedAt: string;
  daysOnMarket: number | null;
};
export type AccountShowing = { propertyId: string | null; scheduledAt: string | null; outcome: string | null };
export type MoneyTotals = {
  rentCents: number;
  expenseCents: number;
  rentCount: number;
  expenseCount: number;
  /** Operating expenses by category, as on Money > Income statement. */
  categories?: { label: string; cents: number }[];
};

/**
 * Expense lines for the summary: the biggest categories this year, the rest
 * as one "Other costs" line, so the lines always add up to the total. Pure.
 */
export function expenseLines(
  month: readonly { label: string; cents: number }[],
  ytd: readonly { label: string; cents: number }[],
  keep = 4,
): { label: string; monthCents: number; ytdCents: number }[] {
  const sorted = [...ytd].filter((c) => c.cents !== 0).sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label));
  const top = sorted.slice(0, sorted.length > keep + 1 ? keep : sorted.length);
  const topLabels = new Set(top.map((c) => c.label));
  const m = (label: string) => month.filter((c) => c.label === label).reduce((s, c) => s + c.cents, 0);
  const lines = top.map((c) => ({ label: c.label, monthCents: m(c.label), ytdCents: c.cents }));
  const restY = sorted.filter((c) => !topLabels.has(c.label)).reduce((s, c) => s + c.cents, 0);
  const restM = month.filter((c) => !topLabels.has(c.label)).reduce((s, c) => s + c.cents, 0);
  if (restY !== 0 || restM !== 0) lines.push({ label: "Other costs", monthCents: restM, ytdCents: restY });
  return lines;
}

/** Net as a share of rent: "12.5%", or null when no rent came in. Pure. */
export function marginPct(netCents: number, rentCents: number): string | null {
  if (rentCents <= 0) return null;
  return `${((netCents / rentCents) * 100).toFixed(1)}%`;
}

export type AccountReportInput = {
  orgName: string | null;
  /** First day of the reported month, YYYY-MM-DD. */
  monthStart: string;
  /** First day of the next month (exclusive). */
  monthEnd: string;
  /** Today, YYYY-MM-DD (Toronto). Days on market count to here. */
  today: string;
  properties: readonly AccountProperty[];
  outcomes: readonly AccountOutcome[];
  leads: readonly LeadLite[];
  showings: readonly AccountShowing[];
  costs: readonly CostLite[];
  /** From the income statement. null when the account's plan has no books. */
  books: { month: MoneyTotals; ytd: MoneyTotals } | null;
  reportsUrl: string;
};

export type UnitLine = {
  propertyId: string;
  address: string;
  state: "on_market" | "rented";
  /** Days on the market so far, or days it took to rent. */
  days: number | null;
  rentedOn: string | null;
  inquiriesMonth: number;
  inquiriesToDate: number;
  showingsBooked: number;
  showingsHeld: number;
};

export type AccountReport = {
  subject: string;
  html: string;
  text: string;
  /** No rentals at all: do not send. */
  empty: boolean;
  facts: {
    trackedUnits: number;
    vacantUnits: number;
    offMarketUnits: number;
    vacancyRatePct: number | null;
    rentedMonth: number;
    rentedAvgDays: number | null;
    onMarket: number;
    longestOnMarketDays: number | null;
    units: UnitLine[];
    adsMonthCents: number;
    adsYtdCents: number;
    money: null | {
      month: { rentCents: number; expenseCents: number; adsNotInBooksCents: number; netCents: number };
      ytd: { rentCents: number; expenseCents: number; adsNotInBooksCents: number; netCents: number };
      hasRecords: boolean;
    };
    sites: SiteCostRow[];
    advice: string[];
  };
};

function day(iso: string | null | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso ?? "");
  return m ? m[1] : null;
}
function inRange(d: string | null, from: string, to: string): boolean {
  return !!d && d >= from && d < to;
}
function daysBetween(a: string, b: string): number {
  return Math.max(0, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000));
}
function niceDay(d: string): string {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
/** Money with a minus sign in front of the dollar sign: -$1,250. */
export function signedDollars(cents: number): string {
  return cents < 0 ? `-${dollars(Math.abs(cents))}` : dollars(cents);
}

/**
 * Site ad costs that are not already in the books. A cost counts as already
 * there when an advertising expense has the same amount on the same day (each
 * expense matches one cost at most). Pure.
 */
export function adsNotInBooks(
  costs: readonly { amount_cents: number; spent_on: string }[],
  adExpenses: readonly { amountCents: number; day: string }[],
): { amount_cents: number; spent_on: string }[] {
  const pool = adExpenses.map((e) => ({ ...e, used: false }));
  const out: { amount_cents: number; spent_on: string }[] = [];
  for (const c of costs) {
    const hit = pool.find((e) => !e.used && e.amountCents === c.amount_cents && e.day === c.spent_on);
    if (hit) hit.used = true;
    else out.push(c);
  }
  return out;
}

export function buildAccountReport(input: AccountReportInput & { adExpenses?: readonly { amountCents: number; day: string }[] }): AccountReport {
  const { monthStart: ms, monthEnd: me, today } = input;
  const yearStart = `${ms.slice(0, 4)}-01-01`;
  const month = monthName(ms);
  const monthOnly = month.split(" ")[0];

  // Units: rented or for rent. Off the market (owner living there, a reno, an
  // old rental) is left out of the vacancy rate and named in a note.
  const status = (p: AccountProperty) => (p.status ?? "").toLowerCase();
  const available = input.properties.filter((p) => status(p) === "available");
  const leased = input.properties.filter((p) => status(p) === "leased");
  const offMarket = input.properties.filter((p) => status(p) !== "available" && status(p) !== "leased" && status(p) !== "archived" && status(p) !== "draft");
  const tracked = available.length + leased.length;
  const vacancyRatePct = tracked > 0 ? Math.round((available.length / tracked) * 100) : null;

  // One row per rental: a rental set Rented twice in the month counts once (latest).
  const latest = new Map<string, AccountOutcome>();
  for (const o of input.outcomes) {
    if (!inRange(day(o.leasedAt), ms, me)) continue;
    const key = o.propertyId ?? `${o.address}|${o.leasedAt}`;
    const prev = latest.get(key);
    if (!prev || o.leasedAt > prev.leasedAt) latest.set(key, o);
  }
  const rentedInMonth = [...latest.values()];
  const withDays = rentedInMonth.filter((o) => o.daysOnMarket != null);
  const rentedAvgDays = withDays.length ? Math.round(withDays.reduce((s, o) => s + (o.daysOnMarket ?? 0), 0) / withDays.length) : null;

  const leadsFor = (pid: string) => input.leads.filter((l) => l.property_id === pid);
  const showsFor = (pid: string) =>
    input.showings.filter((s) => s.propertyId === pid && inRange(day(s.scheduledAt), ms, me) && s.outcome !== "cancelled");

  const units: UnitLine[] = [];
  const seen = new Set<string>();
  for (const o of rentedInMonth) {
    if (!o.propertyId || seen.has(o.propertyId)) continue;
    seen.add(o.propertyId);
    const since = day(o.availableSince);
    const until = day(o.leasedAt) ?? me;
    const leads = leadsFor(o.propertyId);
    const shows = showsFor(o.propertyId);
    units.push({
      propertyId: o.propertyId,
      address: shortAddr(o.address),
      state: "rented",
      days: o.daysOnMarket,
      rentedOn: day(o.leasedAt),
      inquiriesMonth: leads.filter((l) => inRange(day(l.created_at), ms, me)).length,
      inquiriesToDate: leads.filter((l) => {
        const d = day(l.created_at);
        return !!d && (!since || d >= since) && d <= until;
      }).length,
      showingsBooked: shows.length,
      showingsHeld: shows.filter((s) => s.outcome === "attended").length,
    });
  }
  for (const p of available) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const since = day(p.availableSince);
    const leads = leadsFor(p.id);
    const shows = showsFor(p.id);
    units.push({
      propertyId: p.id,
      address: shortAddr(p.address),
      state: "on_market",
      days: since ? daysBetween(since, today) : null,
      rentedOn: null,
      inquiriesMonth: leads.filter((l) => inRange(day(l.created_at), ms, me)).length,
      inquiriesToDate: leads.filter((l) => {
        const d = day(l.created_at);
        return !!d && (!since || d >= since);
      }).length,
      showingsBooked: shows.length,
      showingsHeld: shows.filter((s) => s.outcome === "attended").length,
    });
  }
  // Rented first (newest), then on the market (longest first).
  units.sort((a, b) =>
    a.state !== b.state ? (a.state === "rented" ? -1 : 1) : a.state === "rented" ? (b.rentedOn ?? "").localeCompare(a.rentedOn ?? "") : (b.days ?? -1) - (a.days ?? -1),
  );
  const onMarketDays = units.filter((u) => u.state === "on_market" && u.days != null).map((u) => u.days as number);
  const longestOnMarketDays = onMarketDays.length ? Math.max(...onMarketDays) : null;

  // Spend: what was entered under "What each site costs you".
  const costsMonth = input.costs.filter((c) => inRange(c.spent_on, ms, me));
  const costsYtd = input.costs.filter((c) => inRange(c.spent_on, yearStart, me));
  const sum = (rows: readonly { amount_cents: number }[]) => rows.reduce((s, c) => s + Math.max(0, Math.round(c.amount_cents || 0)), 0);
  const adsMonthCents = sum(costsMonth);
  const adsYtdCents = sum(costsYtd);

  // Money: the income statement, plus site ad costs not in the books yet.
  let money: AccountReport["facts"]["money"] = null;
  if (input.books) {
    const adEx = input.adExpenses ?? [];
    const outMonth = sum(adsNotInBooks(costsMonth, adEx));
    const outYtd = sum(adsNotInBooks(costsYtd, adEx));
    const b = input.books;
    money = {
      month: { rentCents: b.month.rentCents, expenseCents: b.month.expenseCents, adsNotInBooksCents: outMonth, netCents: b.month.rentCents - b.month.expenseCents - outMonth },
      ytd: { rentCents: b.ytd.rentCents, expenseCents: b.ytd.expenseCents, adsNotInBooksCents: outYtd, netCents: b.ytd.rentCents - b.ytd.expenseCents - outYtd },
      hasRecords: b.ytd.rentCount + b.ytd.expenseCount > 0,
    };
  }

  // Sites, this year: renters and viewings from the leads, money from the costs.
  const leadsYtd = input.leads.filter((l) => inRange(day(l.created_at), yearStart, me));
  const sites = buildSiteCosts(buildChannelReport(leadsYtd), costsYtd).filter((r) => r.renters > 0 || r.spentCents > 0);
  const advice = buildCostAdvice(sites).map((a) => a.text);
  if (adsYtdCents === 0) {
    advice.push("No site costs are entered for this year, so there is nothing to compare yet. Add what you paid each site on Reports and next month's summary will show the cost of each renter.");
  }

  const rentedLine = rentedInMonth.length
    ? `${plural(rentedInMonth.length, "unit", "units")} rented${rentedAvgDays != null ? `, ${rentedAvgDays} days on average` : ""}`
    : "No units rented";
  const subject = `Your rentals in ${month}: ${plural(available.length, "on the market", "on the market")}, ${rentedInMonth.length} rented`;

  // ---- HTML (email-safe: tables and inline styles only) ----
  const GREEN = "#1f3d2b";
  const LINE = "#e3e8e5";
  const SOFT = "#f4f7f5";
  const th = (t: string, right = false) =>
    `<th style="text-align:${right ? "right" : "left"};font-size:12px;font-weight:600;color:#5b6b62;text-transform:uppercase;letter-spacing:.04em;padding:8px 8px;border-bottom:1px solid ${LINE}">${t}</th>`;
  const td = (t: string, right = false, strong = false) =>
    `<td style="text-align:${right ? "right" : "left"};padding:9px 8px;border-bottom:1px solid ${LINE};font-size:14px;${strong ? "font-weight:700;" : ""}">${t}</td>`;
  const heading = (t: string, sub?: string) =>
    `<h2 style="font-size:17px;color:${GREEN};margin:30px 0 4px">${esc(t)}</h2>${sub ? `<p style="margin:0 0 10px;font-size:13px;color:#5b6b62">${esc(sub)}</p>` : ""}`;
  const tile = (big: string, label: string, sub: string, red = false) =>
    `<td width="50%" style="padding:5px;vertical-align:top"><div style="background:${SOFT};border:1px solid ${LINE};border-radius:10px;padding:14px 12px;text-align:center"><div style="font-size:24px;font-weight:700;color:${red ? "#b42318" : GREEN};line-height:1.1">${esc(big)}</div><div style="font-size:13px;font-weight:600;color:#222;margin-top:6px">${esc(label)}</div><div style="font-size:12px;color:#5b6b62;margin-top:2px">${esc(sub)}</div></div></td>`;

  const h: string[] = [];
  h.push(
    `<div style="background:${GREEN};color:#ffffff;border-radius:12px 12px 0 0;padding:22px 24px"><div style="font-size:13px;opacity:.8">${esc(input.orgName || "Your account")}</div><div style="font-size:22px;font-weight:700;margin-top:4px">Your rentals in ${esc(month)}</div></div>`,
  );
  h.push(`<div style="border:1px solid ${LINE};border-top:0;border-radius:0 0 12px 12px;padding:16px 18px 22px">`);

  const netMonth = money?.hasRecords ? signedDollars(money.month.netCents) : "-";
  const netRed = !!money?.hasRecords && money.month.netCents < 0;
  h.push(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${[
      tile(vacancyRatePct == null ? "-" : `${vacancyRatePct}%`, "Vacancy rate", tracked ? `${available.length} of ${tracked} units empty` : "No units yet"),
      tile(String(rentedInMonth.length), `Rented in ${monthOnly}`, rentedAvgDays != null ? `${rentedAvgDays} days on average` : "No days recorded"),
      tile(String(available.length), "On the market", longestOnMarketDays != null ? `Longest ${longestOnMarketDays} days` : "None right now"),
      tile(netMonth, `Net in ${monthOnly}`, money?.hasRecords ? "Rent in, less costs" : "No books kept here", netRed),
    ]
      .map((cell, i) => (i === 2 ? `</tr><tr>${cell}` : cell))
      .join("")}</tr></table>`,
  );

  // Each unit.
  h.push(heading("Each unit", `Inquiries and showings in ${monthOnly}, and since the unit came on the market.`));
  if (units.length) {
    h.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">`);
    h.push(`<tr>${th("Unit")}${th("Days", true)}${th("Inquiries", true)}${th("Showings", true)}</tr>`);
    for (const u of units) {
      const status =
        u.state === "rented"
          ? `<span style="color:${GREEN};font-weight:600">Rented${u.rentedOn ? ` ${esc(niceDay(u.rentedOn))}` : ""}</span>`
          : `<span style="color:#9a5b00;font-weight:600">On the market</span>`;
      h.push(
        `<tr>${td(`${esc(u.address)}<br><span style="font-size:12px">${status}</span>`)}${td(u.days == null ? "-" : String(u.days), true)}${td(`${u.inquiriesMonth} <span style="color:#8a968f">/ ${u.inquiriesToDate}</span>`, true)}${td(`${u.showingsBooked} <span style="color:#8a968f">/ ${u.showingsHeld}</span>`, true)}</tr>`,
      );
    }
    h.push(`</table>`);
    h.push(`<p style="font-size:12px;color:#5b6b62;margin:6px 0 0">Inquiries: this month / since it came on the market. Showings: booked this month / held. Days: on the market so far, or to rent.</p>`);
  } else {
    h.push(`<p style="font-size:14px;margin:0">No unit was on the market or rented in ${esc(monthOnly)}.</p>`);
  }

  // Income and expenses.
  h.push(heading("Income and expenses", "From your income statement on the Money page."));
  if (!money) {
    h.push(`<p style="font-size:14px;margin:0">Books are part of Starter and up. Ad costs entered on Reports: ${dollars(adsMonthCents)} in ${esc(monthOnly)}, ${dollars(adsYtdCents)} this year.</p>`);
  } else if (!money.hasRecords) {
    h.push(`<p style="font-size:14px;margin:0">No rent or expenses are recorded here this year, so there is no income figure to show. If you keep your books somewhere else, that is where income lives. Ad costs entered on Reports: ${dollars(adsMonthCents)} in ${esc(monthOnly)}, ${dollars(adsYtdCents)} this year.</p>`);
  } else {
    const m = money.month;
    const y = money.ytd;
    h.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">`);
    h.push(`<tr>${th("")}${th(esc(monthOnly), true)}${th("This year", true)}</tr>`);
    h.push(`<tr>${td("Rent received")}${td(dollars(m.rentCents), true)}${td(dollars(y.rentCents), true)}</tr>`);
    h.push(`<tr>${td("Expenses in your books", false, true)}${td(signedDollars(-m.expenseCents), true, true)}${td(signedDollars(-y.expenseCents), true, true)}</tr>`);
    for (const line of expenseLines(input.books?.month.categories ?? [], input.books?.ytd.categories ?? [])) {
      h.push(
        `<tr>${td(`<span style="padding-left:14px;color:#5b6b62">${esc(line.label)}</span>`)}${td(`<span style="color:#5b6b62">${signedDollars(-line.monthCents)}</span>`, true)}${td(`<span style="color:#5b6b62">${signedDollars(-line.ytdCents)}</span>`, true)}</tr>`,
      );
    }
    if (y.adsNotInBooksCents > 0) {
      h.push(`<tr>${td("Site ad costs not in your books")}${td(signedDollars(-m.adsNotInBooksCents), true)}${td(signedDollars(-y.adsNotInBooksCents), true)}</tr>`);
    }
    const cash = (cents: number) => (cents < 0 ? `<span style="color:#b42318">${signedDollars(cents)}</span>` : signedDollars(cents));
    h.push(`<tr style="background:${SOFT}">${td("Net", false, true)}${td(cash(m.netCents), true, true)}${td(cash(y.netCents), true, true)}</tr>`);
    h.push(`<tr>${td("Margin")}${td(marginPct(m.netCents, m.rentCents) ?? "-", true)}${td(marginPct(y.netCents, y.rentCents) ?? "-", true)}</tr>`);
    h.push(`</table>`);
    h.push(`<p style="font-size:12px;color:#5b6b62;margin:6px 0 0">Net here is before mortgage interest. Your income statement shows the full picture.</p>`);
  }

  // Spend by site.
  h.push(heading("What each site cost you this year", "Renters from each site, and what you entered as paid to it."));
  if (sites.length) {
    h.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">`);
    h.push(`<tr>${th("Site")}${th("Renters", true)}${th("Spent", true)}${th("Each", true)}</tr>`);
    for (const s of sites) {
      h.push(
        `<tr>${td(esc(s.site))}${td(String(s.renters), true)}${td(s.spentCents ? dollars(s.spentCents) : "Free", true)}${td(s.perRenterCents != null ? dollars(s.perRenterCents) : "-", true)}</tr>`,
      );
    }
    h.push(`</table>`);
    h.push(`<p style="font-size:12px;color:#5b6b62;margin:6px 0 0">Each: what one renter cost from that site.</p>`);
  } else {
    h.push(`<p style="font-size:14px;margin:0">No renters or site costs recorded this year.</p>`);
  }
  if (advice.length) {
    h.push(`<div style="background:${SOFT};border-left:4px solid ${GREEN};border-radius:6px;padding:12px 14px;margin-top:14px"><div style="font-size:13px;font-weight:700;color:${GREEN};margin-bottom:4px">Where to spend</div>${advice.map((a) => `<p style="margin:4px 0;font-size:14px">${esc(a)}</p>`).join("")}</div>`);
  }

  const notes: string[] = [];
  notes.push(`The vacancy rate counts units that are rented or for rent (${tracked}).`);
  if (offMarket.length) notes.push(`${plural(offMarket.length, "unit marked off the market is", "units marked off the market are")} left out.`);
  h.push(`<p style="font-size:12px;color:#5b6b62;margin-top:22px">${esc(notes.join(" "))}</p>`);
  h.push(
    `<p style="text-align:center;margin:20px 0 0"><a href="${esc(input.reportsUrl)}" style="display:inline-block;background:${GREEN};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">Open Reports</a></p>`,
  );
  h.push(`</div>`);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:640px">${h.join("\n")}</div>`;

  const t: string[] = [];
  t.push(`Your rentals in ${month}`);
  t.push(`Vacancy rate: ${vacancyRatePct == null ? "-" : `${vacancyRatePct}%`} (${available.length} of ${tracked} units empty)`);
  t.push(`${rentedLine}. On the market: ${available.length}${longestOnMarketDays != null ? `, longest ${longestOnMarketDays} days` : ""}.`);
  for (const u of units) {
    t.push(`- ${u.address}: ${u.state === "rented" ? `rented${u.rentedOn ? ` ${niceDay(u.rentedOn)}` : ""}` : "on the market"}, ${u.days ?? "-"} days, ${u.inquiriesMonth} inquiries (${u.inquiriesToDate} to date), ${u.showingsBooked} showings booked, ${u.showingsHeld} held`);
  }
  if (money?.hasRecords) t.push(`Net in ${monthOnly}: ${signedDollars(money.month.netCents)}. This year: ${signedDollars(money.ytd.netCents)}.`);
  t.push(`Site costs: ${dollars(adsMonthCents)} in ${monthOnly}, ${dollars(adsYtdCents)} this year.`);
  for (const a of advice) t.push(a);
  t.push(input.reportsUrl);

  return {
    subject,
    html,
    text: t.join("\n"),
    empty: tracked === 0 && units.length === 0,
    facts: {
      trackedUnits: tracked,
      vacantUnits: available.length,
      offMarketUnits: offMarket.length,
      vacancyRatePct,
      rentedMonth: rentedInMonth.length,
      rentedAvgDays,
      onMarket: available.length,
      longestOnMarketDays,
      units,
      adsMonthCents,
      adsYtdCents,
      money,
      sites,
      advice,
    },
  };
}
