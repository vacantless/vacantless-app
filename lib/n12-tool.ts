// lib/n12-tool.ts (S757). The free public Ontario N12 tool.
//
// Engine 4 of the subscriber plan's free tools (after rent increase, the
// Standard Lease and the N4). A landlord who needs the unit back for
// themselves, a family member or a buyer searches for "N12 form". This module
// turns the signed-in N12 rules (lib/n12.ts: 60 days, end of a period, the
// 120-day no-compensation rule from 2026-09-21; lib/n12-snapshot.ts) into a
// no-sign-in tool: parse what a stranger typed into a URL, work out the dates
// and whether one month's rent is owed, and build the same N12FillSnapshot the
// in-app route fills.
//
// Scope, stated on the page: monthly rent due on the 1st. PURE: no I/O, no
// clock (today is an argument). scripts/test-n12-tool.ts runs it.

import { buildN12Snapshot, snapshotToN12Fill, type N12Snapshot } from "./n12-snapshot";
import {
  N12_PROBLEM_TEXT,
  N12_RELATIONSHIPS,
  n12DeemedServiceDate,
  type N12Problem,
  type N12Reason,
  type N12Relationship,
  type N12ServiceMethod,
} from "./n12";
import type { N12FillSnapshot } from "./n12-official-pdf";
import { centsToDollars, longDate, moneyToCents } from "./n4-tool";

export const N12_TOOL_PATH = "/tools/n12";
export const N12_TOOL_SIGNUP_HREF = "/signup?utm_source=vacantless&utm_medium=tool&utm_campaign=n12";

const MAX_TEXT = 120;
const MAX_TENANTS = 4;

export const N12_RELATIONSHIP_LABELS: Record<N12Relationship, { own: string; buyer: string }> = {
  self: { own: "Me, the landlord", buyer: "The buyer" },
  spouse: { own: "My spouse", buyer: "The buyer's spouse" },
  child: { own: "My child", buyer: "The buyer's child" },
  parent: { own: "My parent", buyer: "The buyer's parent" },
  spouse_child: { own: "My spouse's child", buyer: "The buyer's spouse's child" },
  spouse_parent: { own: "My spouse's parent", buyer: "The buyer's spouse's parent" },
};

export type N12ToolInput = {
  reason: N12Reason;
  personName: string;
  relationship: N12Relationship;
  careProvider: boolean;
  rentCents: number;
  serviceDate: string;
  method: N12ServiceMethod;
  /** Last day of a fixed term still running, or null. */
  fixedTermEnd: string | null;
  /** The date the landlord wants; null = the earliest valid date. */
  terminationDate: string | null;
  landlordName: string;
  /** The landlord confirms they are a person, not a company (Reason 1 needs this). */
  landlordIsIndividual: boolean;
  signerFirstName: string;
  signerLastName: string;
  phone: string;
  tenantNames: string[];
  address: string;
};

export type N12ToolResult = {
  deemedServiceDate: string;
  earliestTermination: string;
  noCompensationDate: string;
  terminationDate: string;
  compensationRequired: boolean;
  compensationCents: number | null;
  /** Problems the form must not be filled with, in plain words. */
  problems: { code: N12Problem; text: string }[];
  snapshot: N12Snapshot;
};

export type N12ParseOutcome = { ok: true; input: N12ToolInput } | { ok: false; error: string };
export type N12ComputeOutcome = { ok: true; result: N12ToolResult } | { ok: false; error: string };

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

export function parseN12Params(sp: URLSearchParams): N12ParseOutcome {
  const reason: N12Reason = sp.get("reason") === "2" ? 2 : 1;
  const rentCents = moneyToCents(sp.get("rent"));
  if (rentCents == null) return { ok: false, error: "Enter the monthly rent." };
  const serviceDate = validIso(sp.get("served"));
  if (!serviceDate) return { ok: false, error: "Pick the day you will give the notice." };
  const m = sp.get("method");
  const method: N12ServiceMethod = m === "mail" || m === "courier" ? m : "hand";
  const rel = sp.get("rel");
  const relationship: N12Relationship = (N12_RELATIONSHIPS as readonly string[]).includes(rel ?? "")
    ? (rel as N12Relationship)
    : "self";
  const termRaw = sp.get("term");
  const fixedTermEnd = termRaw ? validIso(termRaw) : null;
  if (termRaw && !fixedTermEnd) return { ok: false, error: "The end of the fixed term is not a valid date." };
  const endRaw = sp.get("end");
  const terminationDate = endRaw ? validIso(endRaw) : null;
  if (endRaw && !terminationDate) return { ok: false, error: "The termination date is not a valid date." };

  return {
    ok: true,
    input: {
      reason,
      personName: cleanText(sp.get("person")),
      relationship,
      careProvider: sp.get("care") === "1",
      rentCents,
      serviceDate,
      method,
      fixedTermEnd,
      terminationDate,
      landlordName: cleanText(sp.get("landlord")),
      landlordIsIndividual: sp.get("individual") === "1",
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

/** The reverse of parseN12Params, for the links the page builds. */
export function n12Query(input: N12ToolInput): string {
  const q = new URLSearchParams();
  q.set("reason", String(input.reason));
  q.set("rent", (input.rentCents / 100).toFixed(2).replace(/\.00$/, ""));
  q.set("served", input.serviceDate);
  q.set("method", input.method);
  q.set("rel", input.relationship);
  if (input.careProvider) q.set("care", "1");
  if (input.fixedTermEnd) q.set("term", input.fixedTermEnd);
  if (input.terminationDate) q.set("end", input.terminationDate);
  if (input.personName) q.set("person", input.personName);
  if (input.landlordName) q.set("landlord", input.landlordName);
  if (input.landlordIsIndividual) q.set("individual", "1");
  if (input.signerFirstName) q.set("fn", input.signerFirstName);
  if (input.signerLastName) q.set("ln", input.signerLastName);
  if (input.phone) q.set("phone", input.phone);
  if (input.tenantNames.length) q.set("tenants", input.tenantNames.join(", "));
  if (input.address) q.set("address", input.address);
  return q.toString();
}

/**
 * Dates, compensation and problems for one notice. A service date in the past
 * is refused outright; everything else comes back as problems so the page can
 * show the dates while the landlord fixes the rest.
 */
export function computeN12Tool(input: N12ToolInput, today: string): N12ComputeOutcome {
  if (input.serviceDate < today) {
    return { ok: false, error: "The notice date can't be in the past. Use today or a later day." };
  }
  if (input.fixedTermEnd && input.fixedTermEnd < input.serviceDate) {
    return { ok: false, error: "The fixed term has already ended. Leave that box blank for a month-to-month tenancy." };
  }
  const { snapshot, problems } = buildN12Snapshot({
    tenantNames: input.tenantNames,
    landlordName: input.landlordName,
    landlordIsIndividual: input.landlordIsIndividual,
    rentalUnitAddress: input.address || null,
    serviceDateISO: input.serviceDate,
    method: input.method,
    dueDay: 1,
    fixedTermEndISO: input.fixedTermEnd,
    terminationDateISO: input.terminationDate,
    reason: input.reason,
    personName: input.personName,
    relationship: input.relationship,
    careProvider: input.careProvider,
    signer: { firstName: input.signerFirstName || null, lastName: input.signerLastName || null, phone: input.phone || null },
    rentCents: input.rentCents,
    formVersion: "2026/10",
    capturedAtIso: `${today}T00:00:00.000Z`,
  });
  return {
    ok: true,
    result: {
      deemedServiceDate: n12DeemedServiceDate(input.serviceDate, input.method),
      earliestTermination: snapshot.earliestTerminationISO,
      noCompensationDate: snapshot.noCompensationDateISO,
      terminationDate: snapshot.terminationDateISO,
      compensationRequired: snapshot.compensationRequired,
      compensationCents: snapshot.compensationCents,
      problems: problems.map((code) => ({ code, text: n12ToolProblemText(code) })),
      snapshot,
    },
  };
}

/** The in-app texts point at the tenancy page; the tool's say what to type. */
function n12ToolProblemText(code: N12Problem): string {
  if (code === "no_tenant") return "Enter the tenant names.";
  if (code === "no_address") return "Enter the rental unit address.";
  if (code === "company_landlord")
    return "Reason 1 (own use) can only be given by a landlord who is a person, not a company. Tick the box if you are, or use the buyer reason.";
  return N12_PROBLEM_TEXT[code];
}

export function n12ToolFill(result: N12ToolResult): N12FillSnapshot {
  return snapshotToN12Fill(result.snapshot);
}

/** One plain sentence for the result card. No legal advice, no em dashes. */
export function n12ResultSentence(input: N12ToolInput, r: N12ToolResult): string {
  const end = `The tenancy can end on ${longDate(r.terminationDate)}.`;
  if (!r.compensationRequired) {
    return `${end} No compensation is owed: the date is at least 120 days after the notice counts as given.`;
  }
  const amount = r.compensationCents != null ? centsToDollars(r.compensationCents) : "one month's rent";
  const tip =
    input.reason === 1 && r.noCompensationDate > r.terminationDate
      ? ` Pick ${longDate(r.noCompensationDate)} or later and no compensation is owed.`
      : "";
  return `${end} You must pay the tenant ${amount} (one month's rent) by that date.${tip}`;
}
