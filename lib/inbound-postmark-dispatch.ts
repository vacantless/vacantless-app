import { DEFAULT_INGEST_DOMAIN, parseIngestAlias, pickIngestToken } from "./email-ingest";
import { parsePortalLeadEmail } from "./portal-lead-email";
import { isKnownPortalSender } from "./portal-senders";

const MAIN_MAIL_DOMAIN = "vacantless.com";

export type InboundPostmarkTarget =
  | { target: "asset"; token: string | null; alias: null }
  | { target: "lead"; token: string; alias: null }
  | { target: "reply"; token: null; alias: string };

type DispatchOptions = {
  ingestDomain?: string;
  mainMailDomain?: string;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function collectPostmarkRecipients(payload: Record<string, unknown>): string[] {
  const recipients: string[] = [];
  for (const key of ["ToFull", "CcFull", "BccFull"]) {
    const arr = payload[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const email =
        item && typeof item === "object" ? str((item as Record<string, unknown>).Email) : "";
      if (email) recipients.push(email);
    }
  }
  for (const key of ["To", "Cc", "OriginalRecipient"]) {
    const value = str(payload[key]);
    if (value) recipients.push(value);
  }
  return recipients;
}

export function collectPostmarkHeaders(payload: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {};
  const headerArr = payload.Headers;
  if (!Array.isArray(headerArr)) return headers;
  for (const header of headerArr) {
    if (!header || typeof header !== "object") continue;
    const record = header as Record<string, unknown>;
    const name = str(record.Name);
    if (!name) continue;
    headers[name] = str(record.Value);
  }
  return headers;
}

function headerValue(headers: Record<string, string>, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value || null;
  }
  return null;
}

function postmarkFrom(payload: Record<string, unknown>): string {
  const fromFull = payload.FromFull;
  return (
    (fromFull && typeof fromFull === "object"
      ? str((fromFull as Record<string, unknown>).Email)
      : "") || str(payload.From)
  );
}

export function pickPostmarkReplyAlias(
  recipients: string[],
  ingestDomain: string = DEFAULT_INGEST_DOMAIN,
  mainMailDomain: string = MAIN_MAIL_DOMAIN,
): string | null {
  for (const recipient of recipients) {
    const ingestAlias = parseIngestAlias(recipient, ingestDomain);
    if (ingestAlias) return ingestAlias;
    const mainAlias = parseIngestAlias(recipient, mainMailDomain);
    if (mainAlias) return mainAlias;
  }
  return null;
}

function looksLikePortalLead(payload: Record<string, unknown>): boolean {
  const headers = collectPostmarkHeaders(payload);
  const from = postmarkFrom(payload);
  if (isKnownPortalSender(from)) return true;
  const replyTo = str(payload.ReplyTo) || headerValue(headers, "Reply-To") || null;
  return parsePortalLeadEmail({
    subject: str(payload.Subject),
    from,
    replyTo,
    htmlBody: str(payload.HtmlBody) || null,
    textBody: str(payload.TextBody) || str(payload.StrippedTextReply) || null,
    headers,
  }).ok;
}

export function routePostmarkInbound(
  payload: Record<string, unknown>,
  opts: DispatchOptions = {},
): InboundPostmarkTarget {
  const ingestDomain = opts.ingestDomain || DEFAULT_INGEST_DOMAIN;
  const mainMailDomain = opts.mainMailDomain || MAIN_MAIL_DOMAIN;
  const recipients = collectPostmarkRecipients(payload);
  const token = pickIngestToken(recipients, ingestDomain);

  if (token) {
    if (looksLikePortalLead(payload)) return { target: "lead", token, alias: null };
    return { target: "asset", token, alias: null };
  }

  const alias = pickPostmarkReplyAlias(recipients, ingestDomain, mainMailDomain);
  if (alias) return { target: "reply", token: null, alias };

  return { target: "asset", token: null, alias: null };
}
