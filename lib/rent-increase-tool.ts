// lib/rent-increase-tool.ts (S746). The free public Ontario rent-increase tool.
//
// Engine 1 of the subscriber plan: every Ontario landlord with a tenant serves a
// rent-increase notice once a year, and searches for the guideline and Form N1
// in the month they do it. This module turns the signed-in engine
// (lib/rent-increase.ts, lib/n1-render.ts, lib/n1-official-pdf.ts) into a
// no-sign-in tool: parse what a stranger typed into a URL, compute the increase,
// and build the same N1Snapshot the served-notice routes already render.
//
// PURE: no I/O, no clock (today is an argument), so scripts/test-rent-increase-tool.ts
// can run it. The routes under app/tools/rent-increase call it with request params.

import {
  deriveRentIncrease,
  guidelineForYear,
  NOTICE_DAYS,
  type RentIncrease,
} from "./rent-increase";
import { parseISODate } from "./proration";
import type { N1Snapshot } from "./n1-render";

export const TOOL_PATH = "/tools/rent-increase";
export const TOOL_SIGNUP_HREF =
  "/signup?utm_source=vacantless&utm_medium=tool&utm_campaign=rent-increase";

const MAX_TEXT = 120;
const MAX_TENANTS = 4;
const MAX_RENT_CENTS = 99_999_999; // the official form's amount comb holds 6 dollar digits

export type ToolInput = {
  /** Current lawful rent in cents. */
  rentCents: number;
  /** Move-in date, or the date of the last increase if there was one (YYYY-MM-DD). */
  baseDate: string;
  /** Unit first occupied after 2018-11-15: the guideline cap does not apply. */
  exempt: boolean;
  /** The day the landlord wants the new rent to start (YYYY-MM-DD), or null for the earliest legal day. */
  wantedEffectiveDate: string | null;
  /** Exempt units only: the new rent the landlord chose, in cents. */
  chosenNewRentCents: number | null;
  landlordName: string;
  landlordPhone: string;
  landlordEmail: string;
  tenantNames: string[];
  address: string;
};

export type ToolResult = {
  /** Soonest legal first day of the new rent under the 12-month rule. */
  earliestEffectiveDate: string;
  /** The first day of the new rent this notice will use. */
  effectiveDate: string;
  /** Hand or mail the N1 on or before this day. */
  serveByDate: string;
  guidelinePercent: number | null;
  currentRentCents: number;
  newRentCents: number | null;
  increaseCents: number | null;
  exempt: boolean;
  /** The landlord asked for a start day the law does not allow yet; the legal day is used instead. */
  wantedTooEarly: boolean;
  /** No guideline is published for the effective year yet. */
  guidelineMissing: boolean;
  status: RentIncrease["status"];
};

export type ParseOutcome =
  | { ok: true; input: ToolInput }
  | { ok: false; error: string };

// --- small pure helpers --------------------------------------------------------

function cleanText(v: string | null | undefined, max = MAX_TEXT): string {
  if (v == null) return "";
  return String(v)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** "1,500", "$1500.00", "1500" -> 150000. Null for anything that is not money. */
export function dollarsToCents(v: string | null | undefined): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  if (!Number.isFinite(cents) || cents <= 0 || cents > MAX_RENT_CENTS) return null;
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

function isoOrNull(v: string | null | undefined): string | null {
  const s = cleanText(v, 10);
  return parseISODate(s) ? s : null;
}

function utcMs(iso: string): number {
  const p = parseISODate(iso)!;
  return Date.UTC(p.year, p.month - 1, p.day);
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Sentence-safe long date: "February 1, 2027". */
export function longDate(iso: string | null): string {
  if (!iso) return "";
  const p = parseISODate(iso);
  if (!p) return iso;
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

// --- parse ------------------------------------------------------------------------

/**
 * Read the tool's inputs from a query string. Every field is optional except rent
 * and the base date; everything is cleaned and capped before it reaches a PDF.
 */
export function parseToolParams(sp: URLSearchParams): ParseOutcome {
  const rentCents = dollarsToCents(sp.get("rent"));
  if (rentCents == null) return { ok: false, error: "Enter the current monthly rent." };

  const baseDate = isoOrNull(sp.get("start"));
  if (!baseDate) return { ok: false, error: "Enter the move-in date or the last increase date." };

  const exempt = sp.get("exempt") === "1";
  const wantedEffectiveDate = isoOrNull(sp.get("effective"));
  const chosenNewRentCents = exempt ? dollarsToCents(sp.get("newrent")) : null;

  const tenantNames = cleanText(sp.get("tenants"), MAX_TEXT * MAX_TENANTS)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, MAX_TENANTS);

  return {
    ok: true,
    input: {
      rentCents,
      baseDate,
      exempt,
      wantedEffectiveDate,
      chosenNewRentCents,
      landlordName: cleanText(sp.get("landlord")),
      landlordPhone: cleanText(sp.get("phone"), 40),
      landlordEmail: cleanText(sp.get("email")),
      tenantNames,
      address: cleanText(sp.get("address"), 200),
    },
  };
}

/** The reverse of parseToolParams, for the links the page builds. */
export function toolQuery(input: ToolInput): string {
  const q = new URLSearchParams();
  q.set("rent", (input.rentCents / 100).toFixed(2).replace(/\.00$/, ""));
  q.set("start", input.baseDate);
  if (input.exempt) q.set("exempt", "1");
  if (input.wantedEffectiveDate) q.set("effective", input.wantedEffectiveDate);
  if (input.exempt && input.chosenNewRentCents != null) {
    q.set("newrent", (input.chosenNewRentCents / 100).toFixed(2).replace(/\.00$/, ""));
  }
  if (input.landlordName) q.set("landlord", input.landlordName);
  if (input.landlordPhone) q.set("phone", input.landlordPhone);
  if (input.landlordEmail) q.set("email", input.landlordEmail);
  if (input.tenantNames.length) q.set("tenants", input.tenantNames.join(", "));
  if (input.address) q.set("address", input.address);
  return q.toString();
}

// --- compute -----------------------------------------------------------------------

/**
 * The increase picture for one tenancy as of `today`. Starts from the shared
 * engine, then honours a wanted start day when the law allows it (landlords
 * usually raise rent on the first of a month, not on an anniversary).
 */
export function computeTool(
  input: ToolInput,
  today: string,
  guideline: (year: number) => number | null = guidelineForYear,
): ToolResult | null {
  const base = deriveRentIncrease(
    {
      startDate: input.baseDate,
      lastIncreaseDate: null,
      currentRentCents: input.rentCents,
      exempt: input.exempt,
      guideline,
    },
    today,
  );
  if (!base) return null;

  let effectiveDate = base.effectiveDate;
  let wantedTooEarly = false;
  if (input.wantedEffectiveDate) {
    // ISO dates compare as strings.
    if (input.wantedEffectiveDate >= base.effectiveDate) {
      effectiveDate = input.wantedEffectiveDate;
    } else {
      wantedTooEarly = true;
    }
  }
  const serveByDate = isoFromMs(utcMs(effectiveDate) - NOTICE_DAYS * 86_400_000);
  const effectiveYear = parseISODate(effectiveDate)!.year;

  const currentRentCents = Math.round(input.rentCents);
  let guidelinePercent: number | null = null;
  let newRentCents: number | null = null;
  if (input.exempt) {
    newRentCents = input.chosenNewRentCents != null ? Math.round(input.chosenNewRentCents) : null;
  } else {
    guidelinePercent = guideline(effectiveYear);
    newRentCents =
      guidelinePercent == null
        ? null
        : Math.round(currentRentCents * (1 + guidelinePercent / 100));
  }
  const increaseCents = newRentCents == null ? null : newRentCents - currentRentCents;

  return {
    earliestEffectiveDate: base.earliestEffectiveDate,
    effectiveDate,
    serveByDate,
    guidelinePercent,
    currentRentCents,
    newRentCents,
    increaseCents,
    exempt: input.exempt,
    wantedTooEarly,
    guidelineMissing: !input.exempt && guidelinePercent == null,
    status: base.status,
  };
}

/** The same frozen shape the served-notice routes render, built from the tool. */
export function toolSnapshot(input: ToolInput, result: ToolResult, nowIso: string): N1Snapshot {
  return {
    currentRentCents: result.currentRentCents,
    newRentCents: result.newRentCents,
    increaseCents: result.increaseCents,
    currentRent: centsToDollars(result.currentRentCents),
    newRent: result.newRentCents == null ? null : centsToDollars(result.newRentCents),
    increaseAmount: result.increaseCents == null ? null : centsToDollars(result.increaseCents),
    guidelinePercent: result.guidelinePercent,
    effectiveDate: result.effectiveDate,
    serveByDate: result.serveByDate,
    exempt: result.exempt,
    landlordName: input.landlordName || "Landlord",
    landlordPhone: input.landlordPhone || null,
    landlordEmail: input.landlordEmail || null,
    tenantNames: input.tenantNames,
    rentalUnitAddress: input.address || null,
    capturedAtIso: nowIso,
  };
}

/** One plain sentence for the result card. No legal advice, no em dashes. */
export function resultSentence(r: ToolResult): string {
  const start = longDate(r.effectiveDate);
  const serve = longDate(r.serveByDate);
  if (r.exempt) {
    return `This unit is exempt from the guideline cap, so you choose the new rent. Give the notice by ${serve} for a ${start} start.`;
  }
  if (r.guidelineMissing) {
    return `Ontario has not published the guideline for ${r.effectiveDate.slice(0, 4)} yet. Give the notice by ${serve} for a ${start} start, once the guideline is out.`;
  }
  const amount = centsToDollars(r.newRentCents);
  const up = centsToDollars(r.increaseCents);
  return `You can raise the rent to ${amount} a month (up ${up}) starting ${start}. Give the tenant the N1 by ${serve}.`;
}
