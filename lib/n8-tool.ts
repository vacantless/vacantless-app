// lib/n8-tool.ts (S757). The free public Ontario N8 tool (persistent late rent).
//
// Engine 5 of the free tools. The rules are lib/n8.ts, the same the signed-in
// N8 uses: O. Reg. 516/06 s. 8.1 (O. Reg. 241/26, in force 2026-09-21) counts a
// tenant who paid rent more than 7 days late at least 3 times in any 6 months.
// Only rent due on or after 2026-09-21 counts toward the 3 (N8_RULE_FROM,
// tenant-protective, S757 reading of the regulation: it has no transition
// rule); earlier late payments go in the details as history. The termination
// date follows the N12's: 60 days, the last day of a period or the fixed term.
//
// The landlord types, for each of the last 6 rent months, the day the rent was
// paid in full (blank = on time). Scope: monthly rent due on the 1st, paid in
// full in the end (rent still owing is an N4). PURE: no I/O, no clock.

import {
  N8_PROBLEM_TEXT,
  N8_RULE_FROM,
  N8_MIN_LATE_COUNT,
  countableLatePeriods,
  earliestN8TerminationDate,
  findLatePeriods,
  n8DetailsText,
  n8DueDate,
  n8Problems,
  type N8LatePeriod,
  type N8Payment,
  type N8Problem,
} from "./n8";
import { addDaysISO, n12DeemedServiceDate, type N12ServiceMethod } from "./n12";
import type { N8FillSnapshot } from "./n8-official-pdf";
import { formatPeriodMonth } from "./payments";
import { longDate, moneyToCents } from "./n4-tool";

export const N8_TOOL_PATH = "/tools/n8";
export const N8_TOOL_SIGNUP_HREF = "/signup?utm_source=vacantless&utm_medium=tool&utm_campaign=n8";

const MAX_TEXT = 120;
const MAX_TENANTS = 4;

export type N8ToolInput = {
  rentCents: number;
  serviceDate: string;
  method: N12ServiceMethod;
  /** YYYY-MM -> the day that month's rent was paid in full (YYYY-MM-DD). Months not listed were on time. */
  paidOn: Record<string, string>;
  fixedTermEnd: string | null;
  terminationDate: string | null;
  landlordName: string;
  signerFirstName: string;
  signerLastName: string;
  phone: string;
  tenantNames: string[];
  address: string;
};

export type N8ToolResult = {
  late: N8LatePeriod[];
  counted: N8LatePeriod[];
  earlier: N8LatePeriod[];
  deemedServiceDate: string;
  earliestTermination: string;
  terminationDate: string;
  details: string;
  problems: { code: N8Problem; text: string }[];
};

export type N8ParseOutcome = { ok: true; input: N8ToolInput } | { ok: false; error: string };
export type N8ComputeOutcome = { ok: true; result: N8ToolResult } | { ok: false; error: string };

function cleanText(v: string | null | undefined, max = MAX_TEXT): string {
  if (v == null) return "";
  return String(v)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function validIso(v: string | null | undefined): string | null {
  const s = cleanText(v, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s ? s : null;
}

/**
 * The rent months the tool asks about: every month whose rent (due on the 1st)
 * fell in the 6 months before the service date, oldest first, as YYYY-MM.
 */
export function n8MonthsToAsk(serviceDate: string): string[] {
  const windowStart = addDaysISO(serviceDate, -183);
  const out: string[] = [];
  let y = Number(serviceDate.slice(0, 4));
  let m = Number(serviceDate.slice(5, 7));
  for (let i = 0; i < 8; i++) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    const due = n8DueDate(`${ym}-01`, 1);
    if (due <= serviceDate && due >= windowStart) out.unshift(ym);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export function parseN8Params(sp: URLSearchParams): N8ParseOutcome {
  const rentCents = moneyToCents(sp.get("rent"));
  if (rentCents == null) return { ok: false, error: "Enter the monthly rent." };
  const serviceDate = validIso(sp.get("served"));
  if (!serviceDate) return { ok: false, error: "Pick the day you will give the notice." };
  const m = sp.get("method");
  const method: N12ServiceMethod = m === "mail" || m === "courier" ? m : "hand";
  const termRaw = sp.get("term");
  const fixedTermEnd = termRaw ? validIso(termRaw) : null;
  if (termRaw && !fixedTermEnd) return { ok: false, error: "The end of the fixed term is not a valid date." };
  const endRaw = sp.get("end");
  const terminationDate = endRaw ? validIso(endRaw) : null;
  if (endRaw && !terminationDate) return { ok: false, error: "The termination date is not a valid date." };

  // late=2026-10:2026-10-12|2026-11:2026-11-15
  const allowed = new Set(n8MonthsToAsk(serviceDate));
  const paidOn: Record<string, string> = {};
  const lateRaw = cleanText(sp.get("late"), 400);
  if (lateRaw) {
    for (const part of lateRaw.split("|").slice(0, 8)) {
      const [ym, day] = part.split(":");
      const date = validIso(day);
      if (!/^\d{4}-\d{2}$/.test(ym ?? "") || !date) return { ok: false, error: "A payment date is not a valid date." };
      if (!allowed.has(ym)) continue;
      paidOn[ym] = date;
    }
  }

  return {
    ok: true,
    input: {
      rentCents,
      serviceDate,
      method,
      paidOn,
      fixedTermEnd,
      terminationDate,
      landlordName: cleanText(sp.get("landlord")),
      signerFirstName: cleanText(sp.get("fn"), 60),
      signerLastName: cleanText(sp.get("ln"), 60),
      phone: cleanText(sp.get("phone"), 40),
      tenantNames: cleanText(sp.get("tenants"), MAX_TEXT * MAX_TENANTS)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, MAX_TENANTS),
      address: cleanText(sp.get("address"), 200),
    },
  };
}

export function n8Query(input: N8ToolInput): string {
  const q = new URLSearchParams();
  q.set("rent", (input.rentCents / 100).toFixed(2).replace(/\.00$/, ""));
  q.set("served", input.serviceDate);
  q.set("method", input.method);
  const late = Object.entries(input.paidOn)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, d]) => `${ym}:${d}`)
    .join("|");
  if (late) q.set("late", late);
  if (input.fixedTermEnd) q.set("term", input.fixedTermEnd);
  if (input.terminationDate) q.set("end", input.terminationDate);
  if (input.landlordName) q.set("landlord", input.landlordName);
  if (input.signerFirstName) q.set("fn", input.signerFirstName);
  if (input.signerLastName) q.set("ln", input.signerLastName);
  if (input.phone) q.set("phone", input.phone);
  if (input.tenantNames.length) q.set("tenants", input.tenantNames.join(", "));
  if (input.address) q.set("address", input.address);
  return q.toString();
}

export function computeN8Tool(input: N8ToolInput, today: string): N8ComputeOutcome {
  if (input.serviceDate < today) {
    return { ok: false, error: "The notice date can't be in the past. Use today or a later day." };
  }
  if (input.fixedTermEnd && input.fixedTermEnd < input.serviceDate) {
    return { ok: false, error: "The fixed term has already ended. Leave that box blank for a month-to-month tenancy." };
  }
  for (const [ym, d] of Object.entries(input.paidOn)) {
    const due = n8DueDate(`${ym}-01`, 1);
    if (d < due) return { ok: false, error: `${formatPeriodMonth(`${ym}-01`)}: the paid date is before the rent was due.` };
    if (d > input.serviceDate) {
      return { ok: false, error: `${formatPeriodMonth(`${ym}-01`)}: the paid date is after the day you give the notice.` };
    }
  }
  const payments: N8Payment[] = Object.entries(input.paidOn).map(([ym, d]) => ({
    amount_cents: input.rentCents,
    period_month: `${ym}-01`,
    paid_on: d,
  }));
  const late = findLatePeriods({ rentCents: input.rentCents, payments, asOfISO: input.serviceDate, dueDay: 1 });
  const counted = countableLatePeriods(late);
  const earlier = late.filter((l) => l.dueISO < N8_RULE_FROM);
  const dateInput = { serviceDateISO: input.serviceDate, method: input.method, dueDay: 1, fixedTermEndISO: input.fixedTermEnd };
  const earliestTermination = earliestN8TerminationDate(dateInput);
  const terminationDate = input.terminationDate || earliestTermination;
  const details = n8DetailsText(input.rentCents, 1, late);
  const problems = n8Problems({
    ...dateInput,
    terminationDateISO: terminationDate,
    lateCount: counted.length,
    details,
    tenantNames: input.tenantNames,
    rentalUnitAddress: input.address || null,
  });
  return {
    ok: true,
    result: {
      late,
      counted,
      earlier,
      deemedServiceDate: n12DeemedServiceDate(input.serviceDate, input.method),
      earliestTermination,
      terminationDate,
      details,
      problems: problems.map((code) => ({ code, text: n8ToolProblemText(code) })),
    },
  };
}

function n8ToolProblemText(code: N8Problem): string {
  if (code === "no_tenant") return "Enter the tenant names.";
  if (code === "no_address") return "Enter the rental unit address.";
  if (code === "too_few_late")
    return `The 3-in-6 rule needs at least ${N8_MIN_LATE_COUNT} months where rent was paid more than 7 days late, counting rent due on or after September 21, 2026.`;
  return N8_PROBLEM_TEXT[code];
}

/**
 * The first rent month that can make a third countable late payment: under the
 * rule, the earliest an N8 can rest on 3 late payments is after the December
 * 2026 rent is more than 7 days late. Used for the "not yet" sentence.
 */
export const N8_FIRST_POSSIBLE_THIRD = "2026-12-09";

export function n8ToolFill(input: N8ToolInput, result: N8ToolResult): N8FillSnapshot {
  return {
    tenantNames: input.tenantNames,
    landlordName: input.landlordName,
    rentalUnitAddress: input.address || null,
    terminationDateISO: result.terminationDate,
    details: result.details,
    signer: { firstName: input.signerFirstName || null, lastName: input.signerLastName || null, phone: input.phone || null },
  };
}

export function n8ResultSentence(input: N8ToolInput, r: N8ToolResult): string {
  const n = r.counted.length;
  if (n >= N8_MIN_LATE_COUNT) {
    return `Rent was paid more than 7 days late ${n} times in the last 6 months. The notice can end the tenancy on ${longDate(r.terminationDate)}.`;
  }
  const have = n === 0 ? "No late payment counts yet" : `${n} late payment${n === 1 ? " counts" : "s count"} so far`;
  const soonest =
    input.serviceDate < N8_FIRST_POSSIBLE_THIRD
      ? `, so the earliest is a December 2026 rent paid on ${longDate(N8_FIRST_POSSIBLE_THIRD)} or later`
      : "";
  return `${have}. The 3-in-6 rule needs 3, and only rent due on or after September 21, 2026 counts${soonest}.`;
}
