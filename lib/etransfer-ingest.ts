import { createHash } from "crypto";
import {
  classifyCredit,
  type CreditRentClassification,
} from "./rent-classify";
import {
  bestRuleForTxn,
  resolveRuleAssignment,
  type CategorizationRule,
  type MatchableTxn,
} from "./categorization-rules";
import type { RentMatchCandidate, RentMatchTenancy } from "./reconciliation";

export type EtransferDirection = "received" | "sent";

export type EtransferParseInput = {
  subject?: string | null;
  textBody?: string | null;
  htmlBody?: string | null;
};

export type ParsedEtransferNotification = {
  direction: EtransferDirection;
  counterpartyName: string;
  amountCents: number;
  txnDate: string;
};

export type EtransferSuggestion = {
  suggestedTenancyId: string | null;
  suggestedCategory: string | null;
  suggestedPropertyId: string | null;
  suggestedBuildingKey: string | null;
  rentClassification: CreditRentClassification["classification"] | null;
  rentCandidates: RentMatchCandidate[];
  ruleMatched: boolean;
};

const HTML_BREAK_RE = /<(?:br|\/p|\/div|\/tr|\/li)\b[^>]*>/gi;
const HTML_TAG_RE = /<[^>]+>/g;
const INTERAC_MARKER_RE =
  /\b(?:interac\s+e-?\s*transfer|interac\s+e-?\s*transfert|virement\s+interac|virement\s+de\s+fonds|envoy[ée]?\s+de\s+l['’]argent)\b/i;

const EN_MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const FR_MONTHS: Record<string, number> = {
  janvier: 1,
  fevrier: 2,
  "février": 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  "août": 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
  "décembre": 12,
};

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(HTML_BREAK_RE, "\n")
    .replace(HTML_TAG_RE, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"');
}

export function etransferText(input: EtransferParseInput): string {
  return [
    input.subject ?? "",
    input.textBody ?? "",
    input.htmlBody ? htmlToText(input.htmlBody) : "",
  ]
    .join("\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n");
}

function bodyLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*>+\s?/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function hasOfficialInteracReference(text: string): boolean {
  const urls = text.match(/\bhttps?:\/\/[^\s<>"')]+/gi) ?? [];
  for (const raw of urls) {
    try {
      const host = new URL(raw).hostname.toLowerCase().replace(/\.$/, "");
      if (host === "interac.ca" || host.endsWith(".interac.ca")) return true;
    } catch {
      // Keep scanning; malformed URLs do not prove authenticity.
    }
  }

  return /(^|[^\w.-])(?:[a-z0-9-]+\.)*interac\.ca(?=$|[\/\s),;:!?])/i.test(text);
}

function cleanCounterpartyName(raw: string | null | undefined): string | null {
  const value = (raw ?? "")
    .replace(/^(?:fwd?|tr|re)\s*:\s*/i, "")
    .replace(/^[\s"'“”]+|[\s"'“”]+$/g, "")
    .replace(/[.;,:-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (value.length < 2 || value.length > 80) return null;
  if (/https?:|www\.|@|interac\.ca|\$|\d{4}/i.test(value)) return null;
  if (/^(your transfer|votre virement|interac|amount|montant|date)$/i.test(value)) return null;
  return value;
}

function directionFromLines(lines: string[]): { direction: EtransferDirection; name: string } | null {
  const matches: { direction: EtransferDirection; name: string }[] = [];

  for (const line of lines) {
    if (line.length > 220) continue;
    let m = line.match(/^(.+?)\s+(?:has\s+)?sent\s+you\s+(?:money|an?\s+interac\s+e-?\s*transfer|\$)/i);
    const receivedEn = cleanCounterpartyName(m?.[1]);
    if (receivedEn) matches.push({ direction: "received", name: receivedEn });

    m = line.match(/^(.+?)\s+vous\s+a\s+envoy[ée]?\s+(?:de\s+l['’]argent|un\s+virement)/i);
    const receivedFr = cleanCounterpartyName(m?.[1]);
    if (receivedFr) matches.push({ direction: "received", name: receivedFr });

    m = line.match(/^Your\s+(?:Interac\s+e-?\s*Transfer\s+)?transfer\s+to\s+(.+?)(?:\s+(?:was|has\s+been|is)\b|$)/i);
    const sentEn = cleanCounterpartyName(m?.[1]);
    if (sentEn) matches.push({ direction: "sent", name: sentEn });

    m = line.match(/^You\s+sent\s+(?:an?\s+)?(?:Interac\s+e-?\s*Transfer\s+)?(?:of\s+)?(?:\$?\s*[\d,. ]+\s+)?to\s+(.+?)(?:\.|$)/i);
    const sentEn2 = cleanCounterpartyName(m?.[1]);
    if (sentEn2) matches.push({ direction: "sent", name: sentEn2 });

    m = line.match(/^Votre\s+virement\s+(?:Interac\s+)?(?:à|a)\s+(.+?)(?:\s+(?:a\s+été|est)(?:\s|$)|$)/i);
    const sentFr = cleanCounterpartyName(m?.[1]);
    if (sentFr) matches.push({ direction: "sent", name: sentFr });

    m = line.match(/^Vous\s+avez\s+envoy[ée]?\s+(?:.+?\s+)?(?:à|a)\s+(.+?)(?:\.|$)/i);
    const sentFr2 = cleanCounterpartyName(m?.[1]);
    if (sentFr2) matches.push({ direction: "sent", name: sentFr2 });
  }

  if (matches.length === 0) return null;
  const directions = new Set(matches.map((match) => match.direction));
  if (directions.size !== 1) return null;
  return matches[0];
}

function parseMoneyToken(raw: string): number | null {
  let value = raw
    .replace(/\b(?:CAD|CA)\b/gi, "")
    .replace(/\$/g, "")
    .replace(/\s|\u00a0/g, "")
    .trim();
  if (!value || !/\d/.test(value)) return null;

  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  const decimalSep = (() => {
    if (lastComma >= 0 && lastDot >= 0) return lastComma > lastDot ? "," : ".";
    if (lastComma >= 0 && /^\d{2}$/.test(value.slice(lastComma + 1))) return ",";
    if (lastDot >= 0 && /^\d{2}$/.test(value.slice(lastDot + 1))) return ".";
    return null;
  })();

  if (decimalSep) {
    const otherSep = decimalSep === "," ? "." : ",";
    value = value.replaceAll(otherSep, "");
    value = value.replace(decimalSep, ".");
  } else {
    value = value.replace(/[,.]/g, "");
  }

  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

function parseAmountFromLine(line: string): number | null {
  const tokens = line.match(/(?:CAD|CA)?\s*\$?\s*\d[\d\s\u00a0,.]*(?:[,.]\d{2})?\s*\$?/gi) ?? [];
  for (const token of tokens) {
    const cents = parseMoneyToken(token);
    if (cents != null) return cents;
  }
  return null;
}

function parseAmount(lines: string[], fullText: string): number | null {
  for (const line of lines) {
    if (!/\b(?:amount|montant)\b/i.test(line)) continue;
    const amount = parseAmountFromLine(line);
    if (amount != null) return amount;
  }

  const moneyTokens = fullText.match(/(?:CAD|CA)?\s*\$\s*\d[\d\s\u00a0,.]*(?:[,.]\d{2})?|\d[\d\s\u00a0,.]*(?:[,.]\d{2})\s*\$/gi) ?? [];
  for (const token of moneyTokens) {
    const cents = parseMoneyToken(token);
    if (cents != null) return cents;
  }
  return null;
}

function isoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > maxDay) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDateFromText(text: string): string | null {
  let m = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));

  m = text.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i);
  if (m) return isoDate(Number(m[3]), EN_MONTHS[m[1].toLowerCase().replace(/\.$/, "")], Number(m[2]));

  m = text.match(/\b(\d{1,2})\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+(20\d{2})\b/i);
  if (m) {
    const monthKey = m[2].toLowerCase().normalize("NFC");
    return isoDate(Number(m[3]), FR_MONTHS[monthKey], Number(m[1]));
  }

  return null;
}

function parseDate(lines: string[], fullText: string): string | null {
  for (const line of lines) {
    if (!/\b(?:date|sent on|received on|reçu le|recue le|envoy[ée]? le)\b/i.test(line)) continue;
    const date = parseDateFromText(line);
    if (date) return date;
  }
  return parseDateFromText(fullText);
}

export function parseEtransferNotification(
  input: EtransferParseInput,
): ParsedEtransferNotification | null {
  const text = etransferText(input);
  if (!INTERAC_MARKER_RE.test(text)) return null;
  if (!hasOfficialInteracReference(text)) return null;

  const lines = bodyLines(text);
  const direction = directionFromLines(lines);
  if (!direction) return null;

  const amountCents = parseAmount(lines, text);
  if (amountCents == null) return null;

  const txnDate = parseDate(lines, text);
  if (!txnDate) return null;

  return {
    direction: direction.direction,
    counterpartyName: direction.name,
    amountCents,
    txnDate,
  };
}

export function etransferDedupeKey(
  provider: string,
  messageId: string | null | undefined,
  parsed: ParsedEtransferNotification,
): string {
  const basis = messageId?.trim()
    ? `${provider}:etransfer:mid:${messageId.trim()}`
    : `${provider}:etransfer:tuple:${parsed.direction}:${parsed.counterpartyName.toLowerCase()}:${parsed.amountCents}:${parsed.txnDate}`;
  return createHash("sha256").update(basis).digest("hex");
}

export function proposeEtransferSuggestion(
  parsed: ParsedEtransferNotification,
  tenancies: RentMatchTenancy[],
  rules: CategorizationRule[],
): EtransferSuggestion {
  if (parsed.direction === "received") {
    const classification = classifyCredit(
      {
        amountCents: parsed.amountCents,
        postedOn: parsed.txnDate,
        description: `Interac e-Transfer from ${parsed.counterpartyName}`,
        source: "interac e-transfer",
      },
      tenancies,
    );
    const best = classification.suggestRent ? classification.amountCandidates[0] : null;
    return {
      suggestedTenancyId: best?.tenancyId ?? null,
      suggestedCategory: null,
      suggestedPropertyId: null,
      suggestedBuildingKey: null,
      rentClassification: classification.classification,
      rentCandidates: classification.amountCandidates,
      ruleMatched: false,
    };
  }

  const matchTxn: MatchableTxn = {
    merchantEntityId: null,
    streamId: null,
    merchant: parsed.counterpartyName,
    accountExternalId: null,
    amountCents: parsed.amountCents,
    postedOn: parsed.txnDate,
  };
  const rule = bestRuleForTxn(rules, matchTxn);
  const assignment = rule ? resolveRuleAssignment(rule) : null;
  return {
    suggestedTenancyId: null,
    suggestedCategory: assignment?.category ?? null,
    suggestedPropertyId: assignment?.propertyId ?? null,
    suggestedBuildingKey: assignment?.buildingKey ?? null,
    rentClassification: null,
    rentCandidates: [],
    ruleMatched: rule != null,
  };
}
