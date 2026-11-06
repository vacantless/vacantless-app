// lib/n4-tool.ts (S755). The free public Ontario N4 tool.
//
// Engine 3 of the subscriber plan, after the rent-increase tool (S746) and the
// Standard Lease filler (S743). A landlord whose tenant has not paid searches
// for "N4 form" the week it happens. This module turns the signed-in N4 rules
// (lib/n4.ts: notice days, row packing; lib/n12.ts: deemed service; and the
// official fill in lib/n4-official-pdf.ts) into a no-sign-in tool: parse what a
// stranger typed into a URL, work out the arrears table and the termination
// date, and build the same N4FillSnapshot the in-app route fills.
//
// Scope, stated on the page: monthly rent due on the 1st. Rent only (no late
// fees, NSF charges or deposits). An N4 that overstates the arrears or gives too
// little notice is void, so every amount is checked and never rounded up.
//
// PURE: no I/O, no clock (today is an argument). scripts/test-n4-tool.ts runs it.

import { minN4NoticeDays, monthlyPeriodKeys, packN4ArrearsRows, type N4FormRow, type N4PeriodRow } from "./n4";
import { addDaysISO, n12DeemedServiceDate, type N12ServiceMethod } from "./n12";
import { formatPeriodMonth } from "./payments";
import type { N4FillSnapshot } from "./n4-official-pdf";

export const N4_TOOL_PATH = "/tools/n4";
export const N4_TOOL_SIGNUP_HREF = "/signup?utm_source=vacantless&utm_medium=tool&utm_campaign=n4";

const MAX_TEXT = 120;
const MAX_TENANTS = 4;
const MAX_MONTHS = 24;
const MAX_RENT_CENTS = 99_999_999;

export type ServiceMethod = N12ServiceMethod;
export const SERVICE_METHODS: { value: ServiceMethod; label: string; note: string }[] = [
  { value: "hand", label: "In person, in the mailbox or under the door", note: "Counts as given that day." },
  { value: "mail", label: "By mail", note: "Counts as given 5 days after you mail it." },
  { value: "courier", label: "By courier", note: "Counts as given the next business day." },
];

export type N4ToolInput = {
  /** Monthly rent in cents (rent due on the 1st). */
  rentCents: number;
  /** First month not paid in full, as YYYY-MM. */
  firstMonth: string;
  /** Amount paid toward each month from firstMonth on, in cents (missing = 0). */
  paidCents: number[];
  /** The day the landlord gives the notice (YYYY-MM-DD). */
  serviceDate: string;
  method: ServiceMethod;
  landlordName: string;
  signerFirstName: string;
  signerLastName: string;
  phone: string;
  tenantNames: string[];
  address: string;
};

export type N4ToolResult = {
  /** One row per unpaid month, as the landlord entered them. */
  months: N4PeriodRow[];
  /** What goes on the form (3 rows at most; older months combined). */
  formRows: N4FormRow[];
  combined: boolean;
  totalOwingCents: number;
  /** The date the notice counts as given (mail +5, courier +1 business day). */
  deemedServiceDate: string;
  noticeDays: number;
  /** Termination date, and the last day the tenant can pay to cancel the notice. */
  terminationDate: string;
};

export type N4ParseOutcome = { ok: true; input: N4ToolInput } | { ok: false; error: string };
export type N4ComputeOutcome = { ok: true; result: N4ToolResult } | { ok: false; error: string };

// --- small pure helpers --------------------------------------------------------

function cleanText(v: string | null | undefined, max = MAX_TEXT): string {
  if (v == null) return "";
  return String(v)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** "1,500", "$1500.00" -> 150000. "0" -> 0 when allowZero. Null for anything else. */
export function moneyToCents(v: string | null | undefined, allowZero = false): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[$,\s]/g, "");
  if (s === "") return allowZero ? 0 : null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  if (!Number.isFinite(cents) || cents > MAX_RENT_CENTS) return null;
  if (cents === 0 && !allowZero) return null;
  return cents;
}

export function centsToDollars(cents: number | null | undefined): string {
  if (cents == null) return "";
  const safe = Math.max(0, Math.round(cents));
  const hasCents = safe % 100 !== 0;
  return (
    "$" +
    (safe / 100).toLocaleString("en-CA", {
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: 2,
    })
  );
}

function validIso(v: string | null | undefined): string | null {
  const s = cleanText(v, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s ? s : null;
}

function validMonth(v: string | null | undefined): string | null {
  const s = cleanText(v, 7);
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return null;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? s : null;
}

/** Sentence-safe long date: "November 13, 2026". */
export function longDate(iso: string | null | undefined): string {
  const s = validIso(iso ?? "");
  if (!s) return iso ?? "";
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function prevMonth(ym: string): string {
  let y = Number(ym.slice(0, 4));
  let m = Number(ym.slice(5, 7)) - 1;
  if (m === 0) {
    m = 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/**
 * The last rent month that is already owing on the service date. Rent due on
 * the 1st is late from the 2nd, so a notice given on the 1st cannot include
 * that month yet.
 */
export function lastOwingMonth(serviceDate: string): string {
  const ym = serviceDate.slice(0, 7);
  return serviceDate.slice(8, 10) === "01" ? prevMonth(ym) : ym;
}

/** The months (YYYY-MM) the tool asks about, oldest first. Empty when the range is wrong. */
export function monthsBetween(firstMonth: string, serviceDate: string): string[] {
  const last = lastOwingMonth(serviceDate);
  return monthlyPeriodKeys(`${firstMonth}-01`, `${last}-01`).map((k) => k.slice(0, 7));
}

// --- parse ------------------------------------------------------------------------

export function parseN4Params(sp: URLSearchParams): N4ParseOutcome {
  const rentCents = moneyToCents(sp.get("rent"));
  if (rentCents == null) return { ok: false, error: "Enter the monthly rent." };
  const firstMonth = validMonth(sp.get("first"));
  if (!firstMonth) return { ok: false, error: "Pick the first month that was not paid in full." };
  const serviceDate = validIso(sp.get("served"));
  if (!serviceDate) return { ok: false, error: "Pick the day you will give the notice." };
  const m = sp.get("method");
  const method: ServiceMethod = m === "mail" || m === "courier" ? m : "hand";

  const paidRaw = cleanText(sp.get("paid"), 400);
  const paidCents: number[] = [];
  if (paidRaw) {
    for (const part of paidRaw.split("|").slice(0, MAX_MONTHS)) {
      const c = moneyToCents(part, true);
      if (c == null) return { ok: false, error: "A paid amount is not a dollar figure." };
      paidCents.push(c);
    }
  }

  const tenantNames = cleanText(sp.get("tenants"), MAX_TEXT * MAX_TENANTS)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, MAX_TENANTS);

  return {
    ok: true,
    input: {
      rentCents,
      firstMonth,
      paidCents,
      serviceDate,
      method,
      landlordName: cleanText(sp.get("landlord")),
      signerFirstName: cleanText(sp.get("fn"), 60),
      signerLastName: cleanText(sp.get("ln"), 60),
      phone: cleanText(sp.get("phone"), 40),
      tenantNames,
      address: cleanText(sp.get("address"), 200),
    },
  };
}

/** The reverse of parseN4Params, for the links the page builds. */
export function n4Query(input: N4ToolInput): string {
  const dollars = (c: number) => (c / 100).toFixed(2).replace(/\.00$/, "");
  const q = new URLSearchParams();
  q.set("rent", dollars(input.rentCents));
  q.set("first", input.firstMonth);
  q.set("served", input.serviceDate);
  q.set("method", input.method);
  if (input.paidCents.some((c) => c > 0)) q.set("paid", input.paidCents.map(dollars).join("|"));
  if (input.landlordName) q.set("landlord", input.landlordName);
  if (input.signerFirstName) q.set("fn", input.signerFirstName);
  if (input.signerLastName) q.set("ln", input.signerLastName);
  if (input.phone) q.set("phone", input.phone);
  if (input.tenantNames.length) q.set("tenants", input.tenantNames.join(", "));
  if (input.address) q.set("address", input.address);
  return q.toString();
}

// --- compute -----------------------------------------------------------------------

/**
 * The arrears table and dates for one notice. Refuses anything that would make
 * the notice void or misleading: a service date in the past, a first month that
 * is not owing yet or was paid in full, a payment larger than the rent, nothing
 * owing at all.
 */
export function computeN4Tool(input: N4ToolInput, today: string): N4ComputeOutcome {
  if (input.serviceDate < today) {
    return { ok: false, error: "The notice date can't be in the past. Use today or a later day." };
  }
  const months = monthsBetween(input.firstMonth, input.serviceDate);
  if (months.length === 0) {
    return {
      ok: false,
      error: `Rent for ${formatPeriodMonth(`${input.firstMonth}-01`)} is not late yet on ${longDate(input.serviceDate)}. An N4 can be given from the day after rent is due.`,
    };
  }
  if (months.length > MAX_MONTHS) {
    return { ok: false, error: `This tool covers up to ${MAX_MONTHS} months of unpaid rent.` };
  }

  const rows: N4PeriodRow[] = [];
  for (let i = 0; i < months.length; i++) {
    const ym = months[i];
    const paid = Math.round(input.paidCents[i] ?? 0);
    if (paid > input.rentCents) {
      return {
        ok: false,
        error: `The payment for ${formatPeriodMonth(`${ym}-01`)} is more than the rent. Put any extra on the month it was meant for.`,
      };
    }
    const from = `${ym}-01`;
    const [y, m] = ym.split("-").map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    rows.push({
      period: from,
      label: formatPeriodMonth(from),
      fromISO: from,
      toISO: `${ym}-${String(lastDay).padStart(2, "0")}`,
      chargedCents: input.rentCents,
      paidCents: paid,
      owingCents: input.rentCents - paid,
    });
  }
  if (rows[0].owingCents <= 0) {
    return {
      ok: false,
      error: `${rows[0].label} is paid in full. Start from the first month that was not.`,
    };
  }
  const totalOwingCents = rows.reduce((s, r) => s + r.owingCents, 0);
  if (totalOwingCents <= 0) return { ok: false, error: "Nothing is owing." };

  const { formRows, combined } = packN4ArrearsRows(rows);
  const deemedServiceDate = n12DeemedServiceDate(input.serviceDate, input.method);
  const noticeDays = minN4NoticeDays("monthly", input.serviceDate);
  const terminationDate = addDaysISO(deemedServiceDate, noticeDays);

  return {
    ok: true,
    result: {
      months: rows,
      formRows,
      combined,
      totalOwingCents,
      deemedServiceDate,
      noticeDays,
      terminationDate,
    },
  };
}

/** True when the form has what it needs to be served (names and address). */
export function n4FormReady(input: N4ToolInput): boolean {
  return !!(input.landlordName && input.tenantNames.length && input.address);
}

export function n4ToolSnapshot(input: N4ToolInput, result: N4ToolResult): N4FillSnapshot {
  return {
    tenantNames: input.tenantNames,
    landlordName: input.landlordName,
    rentalUnitAddress: input.address,
    totalOwingCents: result.totalOwingCents,
    terminationDateISO: result.terminationDate,
    arrearsRows: result.formRows,
    signer: {
      type: "landlord",
      firstName: input.signerFirstName,
      lastName: input.signerLastName,
      dayPhone: input.phone,
    },
  };
}

/** One plain sentence for the result card. No legal advice, no em dashes. */
export function n4ResultSentence(r: N4ToolResult): string {
  return `The tenant owes ${centsToDollars(r.totalOwingCents)} in rent. If they pay it all by ${longDate(r.terminationDate)}, the notice is cancelled. If not, you can apply to the Landlord and Tenant Board the next day.`;
}
