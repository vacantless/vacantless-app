// S736: texting numbers without staff. Pure half (no I/O), tested in
// scripts/test-texting-numbers.ts. Server half: lib/texting-numbers-server.ts.
//
// 1. A Growth landlord presses "Turn on texting": the app buys a local
//    Canadian number in Twilio, points its texts and calls at our app, and
//    switches it on (org_sms_numbers, twilio_sid set).
// 2. The 15-minute sweep retries a purchase that failed (at most 5 tries, an
//    hour apart; admins are emailed once at the 5th failure, the only case a
//    person is needed).
// 3. A number the app bought is released in Twilio 7 days after its account
//    left a plan with texting, or closed. Coming back inside the 7 days keeps
//    the number. A number staff set by hand (no twilio_sid) is never released.

export const MAX_PROVISION_ATTEMPTS = 5;
export const PROVISION_RETRY_GAP_MS = 60 * 60 * 1000;
/** Two presses (or a press and the sweep) never buy two numbers: a try holds for this long. */
export const PROVISION_CLAIM_MS = 10 * 60 * 1000;
export const RELEASE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

// Postal code first letter (FSA) to that area's local area codes, oldest
// (best known) first. Twilio rarely has stock in every code, so we try each.
const BY_FSA_LETTER: Record<string, { region: string; codes: string[] }> = {
  A: { region: "NL", codes: ["709"] },
  B: { region: "NS", codes: ["902", "782"] },
  C: { region: "PE", codes: ["902", "782"] },
  E: { region: "NB", codes: ["506", "428"] },
  G: { region: "QC", codes: ["418", "581", "367"] },
  H: { region: "QC", codes: ["514", "438", "263"] },
  J: { region: "QC", codes: ["450", "579", "819", "873", "354", "468"] },
  K: { region: "ON", codes: ["613", "343", "753"] },
  L: { region: "ON", codes: ["905", "289", "365", "742"] },
  M: { region: "ON", codes: ["416", "647", "437"] },
  N: { region: "ON", codes: ["519", "226", "548", "382"] },
  P: { region: "ON", codes: ["705", "249", "683"] },
  R: { region: "MB", codes: ["204", "431", "584"] },
  S: { region: "SK", codes: ["306", "639", "474"] },
  T: { region: "AB", codes: ["403", "587", "780", "825", "368"] },
  V: { region: "BC", codes: ["604", "778", "236", "250", "672", "257"] },
  X: { region: "NT", codes: ["867"] },
  Y: { region: "YT", codes: ["867"] },
};

// S736: an address with a city but no postal code ("88 Lakeview Ave, Windsor, ON")
// first bought a 249 number for a Windsor account. The bigger cities, by name.
const ON_519 = ["519", "226", "548", "382"];
const ON_416 = ["416", "647", "437"];
const ON_905 = ["905", "289", "365", "742"];
const ON_613 = ["613", "343", "753"];
const ON_705 = ["705", "249", "683"];
const BY_CITY: Record<string, { region: string; codes: string[] }> = {
  windsor: { region: "ON", codes: ON_519 }, london: { region: "ON", codes: ON_519 },
  kitchener: { region: "ON", codes: ON_519 }, waterloo: { region: "ON", codes: ON_519 },
  cambridge: { region: "ON", codes: ON_519 }, guelph: { region: "ON", codes: ON_519 },
  sarnia: { region: "ON", codes: ON_519 }, chatham: { region: "ON", codes: ON_519 },
  brantford: { region: "ON", codes: ON_519 }, leamington: { region: "ON", codes: ON_519 },
  lasalle: { region: "ON", codes: ON_519 }, tecumseh: { region: "ON", codes: ON_519 },
  amherstburg: { region: "ON", codes: ON_519 }, woodstock: { region: "ON", codes: ON_519 },
  toronto: { region: "ON", codes: ON_416 }, "north york": { region: "ON", codes: ON_416 },
  scarborough: { region: "ON", codes: ON_416 }, etobicoke: { region: "ON", codes: ON_416 },
  mississauga: { region: "ON", codes: ON_905 }, brampton: { region: "ON", codes: ON_905 },
  oakville: { region: "ON", codes: ON_905 }, burlington: { region: "ON", codes: ON_905 },
  hamilton: { region: "ON", codes: ON_905 }, markham: { region: "ON", codes: ON_905 },
  vaughan: { region: "ON", codes: ON_905 }, "richmond hill": { region: "ON", codes: ON_905 },
  oshawa: { region: "ON", codes: ON_905 }, whitby: { region: "ON", codes: ON_905 },
  ajax: { region: "ON", codes: ON_905 }, pickering: { region: "ON", codes: ON_905 },
  milton: { region: "ON", codes: ON_905 }, "st. catharines": { region: "ON", codes: ON_905 },
  "st catharines": { region: "ON", codes: ON_905 }, "niagara falls": { region: "ON", codes: ON_905 },
  ottawa: { region: "ON", codes: ON_613 }, kingston: { region: "ON", codes: ON_613 },
  cornwall: { region: "ON", codes: ON_613 }, belleville: { region: "ON", codes: ON_613 },
  barrie: { region: "ON", codes: ON_705 }, sudbury: { region: "ON", codes: ON_705 },
  "north bay": { region: "ON", codes: ON_705 }, peterborough: { region: "ON", codes: ON_705 },
  "sault ste. marie": { region: "ON", codes: ON_705 }, "thunder bay": { region: "ON", codes: ["807"] },
  montreal: { region: "QC", codes: ["514", "438", "263"] }, "montréal": { region: "QC", codes: ["514", "438", "263"] },
  laval: { region: "QC", codes: ["450", "579"] }, "quebec city": { region: "QC", codes: ["418", "581"] },
  gatineau: { region: "QC", codes: ["819", "873"] }, sherbrooke: { region: "QC", codes: ["819", "873"] },
  calgary: { region: "AB", codes: ["403", "587", "825"] }, edmonton: { region: "AB", codes: ["780", "587", "825"] },
  vancouver: { region: "BC", codes: ["604", "778", "236"] }, burnaby: { region: "BC", codes: ["604", "778", "236"] },
  surrey: { region: "BC", codes: ["604", "778", "236"] }, victoria: { region: "BC", codes: ["250", "778", "236"] },
  kelowna: { region: "BC", codes: ["250", "778", "236"] }, winnipeg: { region: "MB", codes: ["204", "431"] },
  regina: { region: "SK", codes: ["306", "639"] }, saskatoon: { region: "SK", codes: ["306", "639"] },
  halifax: { region: "NS", codes: ["902", "782"] }, moncton: { region: "NB", codes: ["506"] },
  fredericton: { region: "NB", codes: ["506"] }, "saint john": { region: "NB", codes: ["506"] },
  "st. john's": { region: "NL", codes: ["709"] },
};

/** The city from "street, City, ON" (the part before the province), lowercased. */
function cityOf(address: string): string | null {
  const parts = address.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
  for (let i = parts.length - 1; i > 0; i--) {
    if (/^(ab|bc|mb|nb|nl|ns|nt|nu|on|pe|qc|sk|yt)\b/.test(parts[i])) return parts[i - 1] || null;
  }
  return parts.length >= 2 ? parts[parts.length - 1] : null;
}

const PROVINCES = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);

export type NumberSearchPlan = { areaCodes: string[]; region: string | null };

/**
 * Where to look for a number, from the account's rental addresses (oldest
 * first). The first address with a postal code decides; otherwise the first
 * known city ("..., Windsor, ON"); otherwise the first province seen;
 * otherwise anywhere in Canada.
 */
export function numberSearchPlan(addresses: ReadonlyArray<string | null | undefined>): NumberSearchPlan {
  for (const a of addresses) {
    const m = /\b([ABCEGHJ-NPRSTVXY])\d[A-Z]\s?\d[A-Z]\d\b/i.exec(String(a ?? ""));
    if (m) {
      const hit = BY_FSA_LETTER[m[1].toUpperCase()];
      if (hit) return { areaCodes: [...hit.codes], region: hit.region };
    }
  }
  for (const a of addresses) {
    const city = cityOf(String(a ?? ""));
    const hit = city ? BY_CITY[city] : undefined;
    if (hit) return { areaCodes: [...hit.codes], region: hit.region };
  }
  for (const a of addresses) {
    const m = /,\s*([A-Z]{2})\b(?:\s|,|$)/.exec(String(a ?? "").toUpperCase());
    if (m && PROVINCES.has(m[1])) return { areaCodes: [], region: m[1] };
  }
  return { areaCodes: [], region: null };
}

/** One entry of Twilio's AvailablePhoneNumbers list, the fields we read. */
export type TwilioAvailableNumber = {
  phone_number?: string;
  address_requirements?: string;
  capabilities?: { SMS?: boolean; sms?: boolean; voice?: boolean };
};

/** The first number we can buy with no address on file that takes texts. Pure. */
export function pickBuyableNumber(list: ReadonlyArray<TwilioAvailableNumber> | null | undefined): string | null {
  for (const n of list ?? []) {
    const phone = String(n.phone_number ?? "");
    if (!/^\+1[2-9]\d{9}$/.test(phone)) continue;
    if ((n.address_requirements ?? "none") !== "none") continue;
    const caps = n.capabilities ?? {};
    if (caps.SMS === false || caps.sms === false) continue;
    return phone;
  }
  return null;
}

export type ProvisionState = {
  plan: string | null;
  planHasTexting: boolean;
  closed: boolean;
  requested: boolean;
  hasNumber: boolean;
  attempts: number;
  triedAtMs: number | null;
  nowMs: number;
  /** A button press tries straight away; the sweep waits PROVISION_RETRY_GAP_MS between tries. */
  fromPress: boolean;
};

export type ProvisionDecision =
  | { go: true }
  | { go: false; why: "not_requested" | "no_texting_on_plan" | "closed" | "has_number" | "gave_up" | "too_soon" | "in_progress" };

export function provisionDecision(s: ProvisionState): ProvisionDecision {
  if (s.closed) return { go: false, why: "closed" };
  if (!s.planHasTexting) return { go: false, why: "no_texting_on_plan" };
  if (s.hasNumber) return { go: false, why: "has_number" };
  if (!s.requested) return { go: false, why: "not_requested" };
  const since = s.triedAtMs == null ? Infinity : s.nowMs - s.triedAtMs;
  if (since < PROVISION_CLAIM_MS) return { go: false, why: "in_progress" };
  if (!s.fromPress) {
    if (s.attempts >= MAX_PROVISION_ATTEMPTS) return { go: false, why: "gave_up" };
    if (since < PROVISION_RETRY_GAP_MS) return { go: false, why: "too_soon" };
  }
  return { go: true };
}

export type ReleaseState = {
  boughtByApp: boolean;
  planHasTexting: boolean;
  closed: boolean;
  lapsedSinceMs: number | null;
  nowMs: number;
};

export type ReleaseDecision = "keep" | "mark_lapsed" | "clear_lapsed" | "release";

/** What to do with a number on each sweep. Pure. */
export function releaseDecision(s: ReleaseState): ReleaseDecision {
  if (!s.boughtByApp) return "keep";
  const stillEntitled = s.planHasTexting && !s.closed;
  if (stillEntitled) return s.lapsedSinceMs == null ? "keep" : "clear_lapsed";
  if (s.lapsedSinceMs == null) return "mark_lapsed";
  return s.nowMs - s.lapsedSinceMs >= RELEASE_GRACE_MS ? "release" : "keep";
}

/** Twilio's FriendlyName for the number, so the console says whose it is. */
export function numberFriendlyName(orgName: string | null | undefined, orgId: string): string {
  const name = String(orgName ?? "").replace(/[^\w .,'&-]/g, "").trim().slice(0, 40);
  return `Vacantless ${name || orgId.slice(0, 8)}`;
}

/** The admin email after the 5th failed try: the one case a person is needed. */
export function provisionGaveUpEmail(input: {
  orgName: string | null;
  orgId: string;
  lastError: string | null;
  plan: NumberSearchPlan;
}): { subject: string; body: string } {
  const where = input.plan.areaCodes.length
    ? `Area codes tried: ${input.plan.areaCodes.join(", ")}`
    : input.plan.region
      ? `Province searched: ${input.plan.region}`
      : "Searched anywhere in Canada";
  return {
    subject: `Texting number not bought: ${input.orgName || input.orgId}`,
    body:
      `The app tried ${MAX_PROVISION_ATTEMPTS} times to buy a texting number for ${input.orgName || "an account"} and stopped.\n` +
      `Account id: ${input.orgId}\n${where}\nLast error: ${input.lastError || "unknown"}\n\n` +
      "Their renters still get every message by email.\n" +
      "Fix the cause in Twilio (balance, address, stock), then add a number on the admin page: " +
      "https://app.vacantless.com/dashboard/admin#texting-numbers",
  };
}
