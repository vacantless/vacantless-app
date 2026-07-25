// ============================================================================
// Portal lead email parsing (S567). Pure — no DOM, no env, no IO. The route
// (app/api/inbound/lead) owns all IO; everything here is unit-tested against
// REAL captured emails in scripts/test-portal-lead-email.ts.
//
// Why this file exists: every channel we can publish to has an inbox nobody
// reads. Rentals.ca has been emailing tenant leads to the operator since
// November 2025 and not one has ever reached Vacantless.
//
// Every rule below was read off two real messages captured 2026-07-25, never
// guessed. Guessing an email format fails worse than guessing a DOM selector,
// because a plausible-but-wrong parser files the portal's own support address
// as the renter and looks like it works.
//
// RENTALS.CA SENDS TWO DIFFERENT THINGS FROM TWO DIFFERENT ADDRESSES:
//
//   1. contact@rentals.ca — "Rentals.ca tenant lead for <address>"
//      The generous one. Carries ALL THREE of:
//        - a machine-readable block:
//            <script id="rentals-lead-data" type="application/ld+json">
//            { name, first_name, last_name, email, phone, message,
//              ad_id, ad_url, email_template_version_code }
//        - headers: X-Rentals-Property-ID, X-Rentals-Lead-Type,
//                   X-Rentals-Lead-Site-Source
//        - Reply-To set to the RENTER, not the portal
//      So the parser is JSON.parse with two independent fallbacks.
//
//   2. no-reply@rentals.ca — "New tour request for <address>, <city>, <prov>"
//      The stingy one. No JSON, no X- headers, no Reply-To. Renter details sit
//      in HTML list items, and it carries something the inquiry does not:
//      REQUESTED TOUR TIMES ("Mon, Jun 22 — Evening (6 PM – 9 PM)"). A renter
//      naming a time is worth more than one asking a question, so this type is
//      parsed rather than ignored, even though it costs more code.
//
// TEMPLATE VERSIONING. Rentals.ca stamps email_template_version_code. When they
// redesign, that changes. We record it and warn on an unknown value rather than
// silently mis-parsing a new layout — the failure we care about is the quiet one.
// ============================================================================

export const RENTALS_CA_LEAD_SENDER = "contact@rentals.ca";
export const RENTALS_CA_TOUR_SENDER = "no-reply@rentals.ca";

/** Senders whose mail this parser understands. The route's per-org allow-list
 *  is a separate, stricter gate — this is only "can we read it at all". */
export const PORTAL_LEAD_SENDERS: readonly string[] = [
  RENTALS_CA_LEAD_SENDER,
  RENTALS_CA_TOUR_SENDER,
];

/** The template versions this parser was written against. Anything else still
 *  parses, but carries a warning so a redesign surfaces as a flag not a silence. */
export const KNOWN_RENTALS_TEMPLATE_VERSIONS: readonly string[] = ["1"];

export type PortalLeadKind = "inquiry" | "tour_request";

export type ParsedPortalLead = {
  portal: "rentals_ca";
  kind: PortalLeadKind;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  /** The unit as the portal reported it. "None" is normalized to null. */
  unit: string | null;
  /** The portal's own listing id. The exact join key to listing_posts.notes. */
  adId: string | null;
  /** The public ad url. The exact join key to listing_posts.url. */
  adUrl: string | null;
  /** Free-text tour windows, verbatim. Tour requests only. Never re-interpreted
   *  into a timestamp here — an operator reads them; guessing a date from
   *  "Evening (6 PM - 9 PM)" would invent precision the renter did not give. */
  requestedTimes: string[];
  /** Address as it appeared in the subject line. A weak hint, last-resort only. */
  subjectAddress: string | null;
  templateVersion: string | null;
  /** "exact" = straight off the portal's own structured payload.
   *  "derived" = scraped out of human-facing text and worth less trust. */
  confidence: "exact" | "derived";
  warnings: string[];
};

export type PortalLeadParseInput = {
  subject?: string | null;
  from?: string | null;
  replyTo?: string | null;
  htmlBody?: string | null;
  textBody?: string | null;
  /** Raw header map from the inbound provider, any casing. */
  headers?: Record<string, string> | null;
};

export type PortalLeadParseResult =
  | { ok: true; lead: ParsedPortalLead }
  | { ok: false; reason: string };

// --- small shared helpers ---------------------------------------------------

/** Lowercased bare address out of "Name <a@b.c>" or "a@b.c". */
export function bareAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const angled = /<([^>]+)>/.exec(value);
  const raw = (angled ? angled[1] : value).trim().toLowerCase();
  return raw.includes("@") ? raw : null;
}

/** Display name out of "Name <a@b.c>", or null when there is only an address. */
export function displayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const angled = /^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/.exec(value);
  const name = angled ? angled[1].trim() : "";
  return name.length > 0 ? name : null;
}

/** Case-insensitive header read; inbound providers disagree on casing. */
export function header(
  headers: Record<string, string> | null | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === want) {
      const t = (v ?? "").trim();
      return t.length > 0 ? t : null;
    }
  }
  return null;
}

/**
 * Decode quoted-printable, but only when the body actually looks encoded.
 * Postmark hands us decoded bodies; a raw MIME part (a forwarded .eml, a
 * different provider) does not. Running this unconditionally would corrupt a
 * legitimate "=" in decoded text, so it is gated on seeing the telltale
 * =XX escapes or soft line breaks.
 */
export function decodeQuotedPrintableIfNeeded(body: string): string {
  const looksEncoded = /=\r?\n/.test(body) || /=[0-9A-F]{2}/.test(body);
  if (!looksEncoded) return body;
  return body
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_m, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // A trailing "---" is the rule the plain-text template draws before its
  // footer; it is a separator, not content.
  const t = value
    .replace(/\s+/g, " ")
    .replace(/(?:\s*-{3,})+\s*$/, "")
    .trim();
  if (!t) return null;
  // Rentals.ca writes a literal "None" for an absent unit.
  if (/^none$/i.test(t)) return null;
  return t;
}

/** Turn an HTML body into newline-separated visible text. Block boundaries
 *  become newlines FIRST, so a run of <li> items does not collapse into one
 *  unsplittable line — that collapsing is exactly what makes the plain-text
 *  part of a tour request hard to parse. */
export function htmlToLines(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(li|p|div|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

// --- 1. the structured payload (the good path) ------------------------------

/**
 * Pull the JSON rentals.ca embeds in the HTML part of a tenant lead. Matched on
 * the script's id rather than its position, so unrelated ld+json (schema.org
 * markup, tracking blobs) cannot be mistaken for it.
 */
export function extractRentalsLeadJson(
  htmlBody: string | null | undefined,
): Record<string, unknown> | null {
  if (!htmlBody) return null;
  const html = decodeQuotedPrintableIfNeeded(htmlBody);
  const m =
    /<script[^>]*id\s*=\s*["']?rentals-lead-data["']?[^>]*>([\s\S]*?)<\/script>/i.exec(
      html,
    );
  if (!m) return null;
  try {
    const parsed: unknown = JSON.parse(m[1].trim());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

// --- 2. labelled fields out of human-facing text ----------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Read "Label: value" out of text where the value runs until the next known
 * boundary. Rentals.ca's plain-text tour request is ONE FLOWED PARAGRAPH with no
 * line breaks between fields, so a line-based parse swallows the rest of the
 * email into whichever field it reads first.
 *
 * Two kinds of boundary, and the distinction matters:
 *   - `otherLabels` are field labels and only stop the value when FOLLOWED BY A
 *     COLON. A renter who writes "my name is..." mid-message must not truncate it.
 *   - `markers` are the portal's own boilerplate sentences and stop the value on
 *     sight, because they carry no colon ("Please contact the renter to confirm
 *     a tour time..." is what follows the last real field).
 */
export function labelledField(
  text: string,
  label: string,
  otherLabels: readonly string[],
  markers: readonly string[] = [],
): string | null {
  const stops = otherLabels
    .filter((l) => l.toLowerCase() !== label.toLowerCase())
    .map(escapeRe);
  const alts: string[] = [];
  if (stops.length > 0) alts.push(`(?:${stops.join("|")})\\s*:`);
  if (markers.length > 0) alts.push(`(?:${markers.map(escapeRe).join("|")})`);
  const stopAlt = alts.length > 0 ? alts.join("|") : "$";
  const re = new RegExp(
    `${escapeRe(label)}\\s*:\\s*([\\s\\S]*?)(?=\\s*(?:${stopAlt})|$)`,
    "i",
  );
  const m = re.exec(text);
  return m ? cleanText(m[1]) : null;
}

// Field labels. A value runs until the next one of these followed by a colon.
const PORTAL_LABELS = [
  "Name",
  "Email",
  "Phone",
  "Message",
  "Unit",
  "Requested tour times",
] as const;

// Boilerplate that follows the last real field in each template. These stop a
// value WITHOUT needing a colon, which is the only reason the tour request's
// run-on plain-text part parses at all.
const PORTAL_BOILERPLATE = [
  "Please contact the renter",
  "Reply to this email",
  "Thanks, Rentals.ca",
  "You can view the listing at the following URL",
] as const;

/**
 * Tour windows, verbatim. Two shapes to handle, because the two MIME parts of
 * the SAME email disagree: the HTML renders one window per list item, while the
 * plain-text part is a single flowed paragraph with no line breaks at all. The
 * line walk handles the first; the labelled read handles the second.
 */
export function extractRequestedTimes(lines: string): string[] {
  const out: string[] = [];
  const rows = lines.split("\n");
  let capturing = false;
  for (const row of rows) {
    if (/^requested tour times\s*:?$/i.test(row)) {
      capturing = true;
      continue;
    }
    const inline = /^requested tour times\s*:\s*(.+)$/i.exec(row);
    if (inline) {
      capturing = true;
      const v = cleanText(inline[1]);
      if (v) out.push(v);
      continue;
    }
    if (!capturing) continue;
    // The block ends at the portal's own boilerplate.
    if (/^(please contact|thanks|view listing|save time|reply to this)/i.test(row)) break;
    const v = cleanText(row);
    if (v) out.push(v);
  }
  if (out.length > 0) return out;

  const flowed = labelledField(lines, "Requested tour times", PORTAL_LABELS, PORTAL_BOILERPLATE);
  if (!flowed) return [];
  return flowed
    .split(/\s*;\s*/)
    .map((s) => cleanText(s))
    .filter((s): s is string => s != null);
}

// --- 3. subject line --------------------------------------------------------

export function subjectAddressFor(
  kind: PortalLeadKind,
  subject: string | null | undefined,
): string | null {
  if (!subject) return null;
  if (kind === "inquiry") {
    const m = /tenant lead for\s+(.+)$/i.exec(subject);
    return m ? cleanText(m[1]) : null;
  }
  const m = /new tour request for\s+(.+)$/i.exec(subject);
  return m ? cleanText(m[1]) : null;
}

// --- classification ---------------------------------------------------------

export function classifyPortalLeadEmail(
  input: PortalLeadParseInput,
): PortalLeadKind | null {
  const from = bareAddress(input.from);
  const subject = (input.subject ?? "").trim();
  if (from === RENTALS_CA_LEAD_SENDER || /tenant lead for/i.test(subject)) {
    return "inquiry";
  }
  if (from === RENTALS_CA_TOUR_SENDER || /new tour request for/i.test(subject)) {
    return "tour_request";
  }
  return null;
}

// --- the parser -------------------------------------------------------------

/**
 * Parse one rentals.ca notification into a lead. Order of trust, highest first:
 *   1. the embedded JSON payload (marks the result "exact")
 *   2. X-Rentals-* headers and Reply-To
 *   3. labelled text out of the HTML, then the plain-text part
 * Each source fills only what the ones above it left empty, so a partial
 * structured payload still beats a full scrape.
 */
export function parsePortalLeadEmail(
  input: PortalLeadParseInput,
): PortalLeadParseResult {
  const kind = classifyPortalLeadEmail(input);
  if (!kind) return { ok: false, reason: "not_a_recognized_portal_lead" };

  const warnings: string[] = [];
  const json = extractRentalsLeadJson(input.htmlBody);

  const htmlLines = input.htmlBody
    ? htmlToLines(decodeQuotedPrintableIfNeeded(input.htmlBody))
    : "";
  const plain = input.textBody
    ? decodeQuotedPrintableIfNeeded(input.textBody).replace(/\r/g, "")
    : "";
  const scrapeSource = htmlLines.length >= plain.length ? htmlLines : plain;

  const str = (v: unknown): string | null =>
    typeof v === "string" ? cleanText(v) : typeof v === "number" ? String(v) : null;

  let name = json ? str(json.name) : null;
  let email = json ? str(json.email) : null;
  let phone = json ? str(json.phone) : null;
  let message = json ? str(json.message) : null;
  let adId = json ? str(json.ad_id) : null;
  let adUrl = json ? str(json.ad_url) : null;
  const templateVersion = json ? str(json.email_template_version_code) : null;

  // 2. headers + Reply-To. On a tenant lead Reply-To IS the renter, which makes
  //    the address trustworthy even when a body scrape would be shaky.
  if (!adId) adId = cleanText(header(input.headers, "X-Rentals-Property-ID"));
  const replyAddr = bareAddress(input.replyTo);
  const fromAddr = bareAddress(input.from);
  if (!email && replyAddr && replyAddr !== fromAddr && !replyAddr.endsWith("@rentals.ca")) {
    email = replyAddr;
  }
  if (!name) name = displayName(input.replyTo);

  // 3. scraped text.
  if (scrapeSource) {
    if (!name) name = labelledField(scrapeSource, "Name", PORTAL_LABELS, PORTAL_BOILERPLATE);
    if (!email) email = labelledField(scrapeSource, "Email", PORTAL_LABELS, PORTAL_BOILERPLATE);
    if (!phone) phone = labelledField(scrapeSource, "Phone", PORTAL_LABELS, PORTAL_BOILERPLATE);
    if (!message) message = labelledField(scrapeSource, "Message", PORTAL_LABELS, PORTAL_BOILERPLATE);
  }
  const unit = scrapeSource ? labelledField(scrapeSource, "Unit", PORTAL_LABELS, PORTAL_BOILERPLATE) : null;

  const requestedTimes =
    kind === "tour_request" && scrapeSource ? extractRequestedTimes(scrapeSource) : [];

  // A scraped "email" that belongs to the portal is the classic quiet failure:
  // it looks like a lead and routes the operator to rentals.ca support.
  if (email && email.endsWith("@rentals.ca")) {
    warnings.push(`discarded portal-owned email ${email}`);
    email = null;
  }

  if (templateVersion && !KNOWN_RENTALS_TEMPLATE_VERSIONS.includes(templateVersion)) {
    warnings.push(
      `unknown rentals.ca template version "${templateVersion}" - re-verify the parser against a fresh sample`,
    );
  }
  if (kind === "inquiry" && !json) {
    warnings.push("tenant lead had no rentals-lead-data payload; fell back to scraping");
  }
  if (!email && !phone) {
    return { ok: false, reason: "no_contact_details_found" };
  }
  if (!adId && !adUrl) {
    warnings.push("no ad id or ad url; the unit must be resolved another way");
  }

  return {
    ok: true,
    lead: {
      portal: "rentals_ca",
      kind,
      name,
      email,
      phone,
      message,
      unit,
      adId,
      adUrl,
      requestedTimes,
      subjectAddress: subjectAddressFor(kind, input.subject),
      templateVersion,
      confidence: json ? "exact" : "derived",
      warnings,
    },
  };
}

/**
 * The note stored on the lead. Keeps the renter's own words first, then the
 * facts an operator needs to act, then anything the parser was unsure about.
 * Written here rather than in the route so it is covered by the unit tests.
 */
export function portalLeadNote(lead: ParsedPortalLead): string {
  const parts: string[] = [];
  if (lead.message) parts.push(lead.message);
  const facts: string[] = [
    `Received from Rentals.ca (${lead.kind === "tour_request" ? "tour request" : "tenant lead"}).`,
  ];
  if (lead.requestedTimes.length > 0) {
    facts.push(`Requested tour times: ${lead.requestedTimes.join("; ")}.`);
  }
  if (lead.unit) facts.push(`Unit as listed: ${lead.unit}.`);
  if (lead.adUrl) facts.push(`Ad: ${lead.adUrl}`);
  else if (lead.adId) facts.push(`Ad id: ${lead.adId}`);
  parts.push(facts.join(" "));
  if (lead.warnings.length > 0) parts.push(`Parser notes: ${lead.warnings.join("; ")}`);
  return parts.join("\n\n");
}
