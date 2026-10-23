// ============================================================================
// Realtor.ca through a partner agent: the pure half.
//
// Realtor.ca is not a site a landlord posts to. A licensed agent lists the
// rental on the MLS and the MLS sends it to Realtor.ca. Noam's broker of record
// settled the rules (S594): full-service representation, a signed agreement and
// written consent before any upload, the fee paid to the brokerage, never to
// Vacantless. So the product offers a request, a person answers it, and the
// app stays the software the landlord already pays for.
//
// Two routes by province (S585 copy, approved in principle by the broker):
//   Ontario         -> an Ontario Realtor.ca listing through a partner agent
//   outside Ontario -> a local Royal LePage agent through the referral network
//
// No DOM, no env, no IO.
// ============================================================================

import { BROWSE_CITY_ALLOWLIST, parseCityFromAddress } from "./browse-surface";

export type BrokerageRequestKind = "realtor_ca_listing" | "local_agent";

export type BrokerageRoute = {
  kind: BrokerageRequestKind;
  province: string | null;
  title: string;
  body: string;
  action: string;
  finePrint: string;
};

const PROVINCE_CODES = [
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
] as const;

const PROVINCE_NAMES: Record<string, string> = {
  alberta: "AB",
  "british columbia": "BC",
  manitoba: "MB",
  "new brunswick": "NB",
  newfoundland: "NL",
  "newfoundland and labrador": "NL",
  "nova scotia": "NS",
  "northwest territories": "NT",
  nunavut: "NU",
  ontario: "ON",
  "prince edward island": "PE",
  quebec: "QC",
  québec: "QC",
  saskatchewan: "SK",
  yukon: "YT",
};

/**
 * The province in a free-text Canadian address, as a two-letter code, or null.
 * Reads a code token ("Windsor, ON N8Y 3B4", "Toronto ON"), a spelled-out
 * name, and finally an Ontario city from the browse allowlist.
 */
export function provinceFromAddress(address: string | null | undefined): string | null {
  const text = (address ?? "").trim();
  if (!text) return null;

  const tokens = text
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  for (const token of tokens) {
    const upper = token.toUpperCase();
    if ((PROVINCE_CODES as readonly string[]).includes(upper) && token === upper) {
      // "ON" the word is also a preposition; a code token is upper-case as typed.
      return upper;
    }
  }

  const lower = text.toLowerCase();
  for (const [name, code] of Object.entries(PROVINCE_NAMES)) {
    if (new RegExp(`(^|[^a-z])${name}([^a-z]|$)`).test(lower)) return code;
  }

  const city = parseCityFromAddress(text);
  if (city && (BROWSE_CITY_ALLOWLIST as readonly string[]).includes(city)) return "ON";

  return null;
}

/** Which route a rental gets. Unknown province reads as Ontario: the app is Ontario first and the follow-up call sorts it. */
export function brokerageRouteFor(address: string | null | undefined): BrokerageRoute {
  const province = provinceFromAddress(address);
  if (province && province !== "ON") {
    return {
      kind: "local_agent",
      province,
      title: "A local agent, outside Ontario",
      body:
        "Your rental is outside Ontario. A local Royal LePage agent can help you lease it.",
      action: "Ask for a local agent",
      finePrint:
        "A licensed Royal LePage agent near you follows up. It is separate from your Vacantless subscription. A person will follow up with you.",
    };
  }
  return {
    kind: "realtor_ca_listing",
    province: province ?? null,
    title: "Realtor.ca, through a partner agent",
    body:
      "Realtor.ca is not a site you post to yourself. A licensed agent lists your rental on the MLS, which sends it to Realtor.ca. In Ontario, a partner agent with Royal LePage can do this for you.",
    action: "Ask about a Realtor.ca listing",
    finePrint:
      "This is a paid service from a licensed real estate agent with Royal LePage. It is separate from your Vacantless subscription. A person will follow up with you. You are free to use any agent, or none.",
  };
}

export type BrokerageRequestInput = {
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  note: string;
};

export type BrokerageRequestValidation =
  | { ok: true; values: BrokerageRequestInput }
  | { ok: false; field: "contact" | "email" };

/** A request needs one way to reach the landlord; an email, if given, must look like one. */
export function validateBrokerageRequest(raw: {
  contactName?: unknown;
  contactPhone?: unknown;
  contactEmail?: unknown;
  note?: unknown;
}): BrokerageRequestValidation {
  const values: BrokerageRequestInput = {
    contactName: clip(raw.contactName, 120),
    contactPhone: clip(raw.contactPhone, 40),
    contactEmail: clip(raw.contactEmail, 200),
    note: clip(raw.note, 1000),
  };
  if (values.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.contactEmail)) {
    return { ok: false, field: "email" };
  }
  if (!values.contactPhone && !values.contactEmail) {
    return { ok: false, field: "contact" };
  }
  return { ok: true, values };
}

function clip(value: unknown, max: number): string {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > max ? s.slice(0, max) : s;
}
