// Pure OFX / QFX transaction-export parser (no I/O) so it can be unit-tested in
// isolation. Run: npx tsx scripts/test-bank-import.ts
//
// This is the file-import counterpart to the live aggregator adapters
// (lib/bank-feed/plaid.ts): it converts a bank's own downloaded transaction
// export into the SAME NormalizedTxn[] the Plaid adapter emits, so everything
// downstream (the staging ledger, dedupe, autoApplyRules, the owner statement)
// is reused verbatim and an imported transaction is indistinguishable from a
// live one. See CSV-OFX-BANK-FEED-IMPORT-SPEC-2026-07-01.md.
//
// OFX ships FIRST because it carries a stable <FITID> per transaction — the OFX
// spec's per-transaction unique id — so re-importing an overlapping date range
// dedupes deterministically. (CSV, which has no txn id, is a later slice.)
//
// PII: OFX <ACCTID> can be a FULL account number. We NEVER keep it — only a
// derived last-4 mask is returned; the raw ACCTID is dropped after masking.

import { createHmac } from "crypto";
import { normalizeAmount, type NormalizedTxn } from "../bank-feed";

export type OfxParseResult =
  | {
      ok: true;
      accountMask: string | null; // last 4 only — NEVER the full ACCTID
      // A NON-REVERSIBLE, stable per-account key (keyed HMAC of the raw ACCTID)
      // used as the synthetic connection's durable id, so two accounts sharing a
      // last-4 mask never collapse into one connection. null when there is no
      // ACCTID or no secret (caller falls back to a label key). The raw ACCTID
      // itself is dropped after this is computed and is never on this object.
      accountKey: string | null;
      accountType: string | null; // e.g. "CHECKING" / "CREDITCARD" (advisory)
      currency: string; // ISO 4217, default "CAD"
      txns: NormalizedTxn[];
      totalBlocks: number; // <STMTTRN> blocks seen (incl. skipped)
      skipped: number; // blocks missing FITID / date / amount
    }
  | { ok: false; reason: "empty" | "no_transactions" };

/**
 * Read a single OFX/SGML leaf tag's value from a text block. OFX leaf elements
 * often OMIT their closing tag (SGML mode), so the value runs from `>` up to the
 * next `<` or a line break. Aggregate tags (STMTTRN) do close, but we only read
 * leaves here. Returns null when absent or empty.
 */
export function ofxTagValue(block: string, tag: string): string | null {
  const m = block.match(new RegExp("<" + tag + ">([^<\\r\\n]*)", "i"));
  if (!m) return null;
  const v = m[1].trim();
  return v === "" ? null : v;
}

/**
 * OFX DTPOSTED is `YYYYMMDD` optionally followed by time / `.mmm` / a
 * `[-5:EST]` tz suffix. Take the first 8 digits and validate the calendar
 * fields. Returns ISO `YYYY-MM-DD` or null when it can't be parsed.
 */
export function ofxDateToIso(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/[^0-9]/g, "");
  if (digits.length < 8) return null;
  const y = digits.slice(0, 4);
  const mo = digits.slice(4, 6);
  const d = digits.slice(6, 8);
  const month = parseInt(mo, 10);
  const day = parseInt(d, 10);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return `${y}-${mo}-${d}`;
}

/**
 * Parse an OFX TRNAMT decimal string ("-42.30", "1200.00", "1200") into SIGNED
 * integer cents. Returns null when it isn't a number. Tolerates a leading "+"
 * and stray spaces; rejects grouping commas by stripping them (OFX shouldn't use
 * them, but some exports do).
 */
export function ofxAmountToCents(raw: string | null | undefined): number | null {
  const t = (raw ?? "").replace(/[\s,]/g, "").replace(/^\+/, "");
  if (t === "" || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Derive a display-only last-4 mask from a raw account id. NEVER stores the
 * full value. Uses the last 4 alphanumerics; null when there are none. */
export function maskAccountId(acctId: string | null | undefined): string | null {
  const alnum = (acctId ?? "").replace(/[^A-Za-z0-9]/g, "");
  if (alnum.length === 0) return null;
  return alnum.slice(-4);
}

/**
 * Derive a NON-REVERSIBLE, stable per-account key from the raw account id, so
 * two DISTINCT accounts that happen to share the same last-4 mask never collapse
 * into one synthetic connection (the S411 P2). A keyed HMAC, not a bare digest,
 * because a card/account number is low-entropy and a plain hash of it (with the
 * last-4 already known) is brute-forceable; the HMAC secret makes the stored key
 * a one-way token, not a recoverable account number. The raw ACCTID is consumed
 * here and then dropped by the caller - never returned or persisted. Returns null
 * when there is no ACCTID or no secret, so the caller falls back to a
 * user-controlled label key.
 */
export function deriveAccountKey(
  rawAcctId: string | null | undefined,
  acctType: string | null | undefined,
  secret: string | null | undefined,
): string | null {
  const id = (rawAcctId ?? "").trim();
  const key = (secret ?? "").trim();
  if (id === "" || key === "") return null;
  const material = `${(acctType ?? "").trim().toUpperCase()}|${id}`;
  return createHmac("sha256", key).update(material).digest("hex").slice(0, 24);
}

/** Split the OFX body into <STMTTRN> content blocks. Handles both the closed
 * form (`<STMTTRN>...</STMTTRN>`) and the rare unclosed SGML form (content runs
 * to the next <STMTTRN> or the end of the transaction list). */
function stmtTrnBlocks(text: string): string[] {
  const out: string[] = [];
  const re = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|<\/BANKTRANLIST>|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1]);
    if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width
  }
  return out;
}

/**
 * Parse a full OFX/QFX file body into NormalizedTxn[]. Sign convention: OFX uses
 * NEGATIVE = money out, so we call normalizeAmount(cents, -1) — the same seam
 * every adapter uses so the sign decision lives in one place. externalId = FITID
 * (the deterministic dedupe key). merchantEntityId / streamId are null (no
 * provider enrichment) so the rules engine degrades to the merchant-name
 * fallback, which bestRuleForTxn already handles.
 */
export function parseOfx(
  text: string,
  opts: { accountKeySecret?: string | null } = {},
): OfxParseResult {
  if ((text ?? "").trim() === "") return { ok: false, reason: "empty" };

  const currency = (ofxTagValue(text, "CURDEF") ?? "CAD").toUpperCase();
  const rawAcctId = ofxTagValue(text, "ACCTID");
  const accountType = ofxTagValue(text, "ACCTTYPE");
  const accountMask = maskAccountId(rawAcctId);
  // Derive the durable per-account key from the raw ACCTID, then let it fall out
  // of scope - it is never placed on the returned object or persisted.
  const accountKey = deriveAccountKey(rawAcctId, accountType, opts.accountKeySecret);

  const blocks = stmtTrnBlocks(text);
  const txns: NormalizedTxn[] = [];
  let skipped = 0;

  for (const block of blocks) {
    const fitid = ofxTagValue(block, "FITID");
    const postedOn = ofxDateToIso(ofxTagValue(block, "DTPOSTED"));
    const cents = ofxAmountToCents(ofxTagValue(block, "TRNAMT"));
    if (!fitid || !postedOn || cents === null) {
      skipped++;
      continue;
    }
    const { amountCents, direction } = normalizeAmount(cents, -1);
    const name = ofxTagValue(block, "NAME");
    const memo = ofxTagValue(block, "MEMO");
    txns.push({
      externalId: fitid,
      accountExternalId: accountMask,
      accountName: null, // the import connection's label carries the display name
      postedOn,
      amountCents,
      direction,
      merchant: name ?? memo,
      description: memo ?? name,
      rawCategory: null,
      currency,
      merchantEntityId: null,
      streamId: null,
    });
  }

  if (blocks.length === 0 && txns.length === 0) {
    return { ok: false, reason: "no_transactions" };
  }
  return { ok: true, accountMask, accountKey, accountType, currency, txns, totalBlocks: blocks.length, skipped };
}
