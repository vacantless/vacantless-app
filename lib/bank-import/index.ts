// The file-import seam (pure, no I/O): a downloaded bank export ->
// NormalizedTxn[], the exact type the live aggregator adapters emit. So an
// imported transaction flows through the SAME staging ledger, dedupe,
// autoApplyRules, and owner statement as a Plaid transaction with zero
// downstream change. See CSV-OFX-BANK-FEED-IMPORT-SPEC-2026-07-01.md.
//
// Slice 1 ships OFX/QFX only (deterministic, FITID dedupe). CSV (which needs a
// per-issuer column mapping) is a later slice and is reported as unsupported.

import { parseOfx } from "./ofx";
import type { NormalizedTxn } from "../bank-feed";

export type ImportFormat = "ofx" | "csv";

/** Sniff the format from the filename, falling back to a content probe. */
export function detectImportFormat(filename: string, content: string): ImportFormat | null {
  const f = (filename ?? "").toLowerCase();
  if (f.endsWith(".ofx") || f.endsWith(".qfx")) return "ofx";
  if (f.endsWith(".csv")) return "csv";
  const head = (content ?? "").slice(0, 4000).toUpperCase();
  if (head.includes("OFXHEADER") || head.includes("<OFX") || head.includes("<STMTTRN")) return "ofx";
  return null;
}

export type ImportParseResult =
  | {
      ok: true;
      format: ImportFormat;
      accountMask: string | null; // last-4 only, for display + rule matching
      accountKey: string | null; // non-reversible durable account id (HMAC), or null
      accountType: string | null;
      currency: string;
      txns: NormalizedTxn[];
      totalRows: number;
      skipped: number;
    }
  | { ok: false; reason: "unknown_format" | "csv_unsupported" | "empty" | "no_transactions" };

/** Parse an uploaded transaction export into NormalizedTxn[]. Pure — the caller
 * reads the file bytes and persists the result. `accountKeySecret` (passed by the
 * server action) keys the per-account HMAC so distinct accounts never merge. */
export function parseImportFile(
  input: { filename: string; content: string },
  opts: { accountKeySecret?: string | null } = {},
): ImportParseResult {
  const format = detectImportFormat(input.filename, input.content);
  if (format === null) return { ok: false, reason: "unknown_format" };
  if (format === "csv") return { ok: false, reason: "csv_unsupported" }; // Slice 3

  const parsed = parseOfx(input.content, { accountKeySecret: opts.accountKeySecret });
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  return {
    ok: true,
    format: "ofx",
    accountMask: parsed.accountMask,
    accountKey: parsed.accountKey,
    accountType: parsed.accountType,
    currency: parsed.currency,
    txns: parsed.txns,
    totalRows: parsed.totalBlocks,
    skipped: parsed.skipped,
  };
}

/**
 * A stable, deterministic external_id for the SYNTHETIC (provider='csv')
 * connection an import hangs off, so re-importing the same account reuses the
 * same connection (and therefore dedupes) while two DISTINCT accounts never
 * merge. Keys on the non-reversible per-account HMAC (`accountKey`) when the file
 * carried an account id + a secret was configured (`ofx:a:<hmac>`); otherwise
 * falls back to a normalized form of the owner-typed label (`ofx:l:<label>`) -
 * a deliberately user-controlled key (two same-named imports intentionally
 * merge; distinct accounts need distinct labels in that fallback). The last-4
 * mask is NEVER the key (it collides across accounts) - it stays display-only.
 */
export function importConnectionExternalId(
  format: ImportFormat,
  accountKey: string | null,
  labelFallback: string,
): string {
  const key = (accountKey ?? "").trim();
  return key !== "" ? `${format}:a:${key}` : `${format}:l:${normalizeLabelKey(labelFallback)}`;
}

function normalizeLabelKey(s: string): string {
  const k = (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return k === "" ? "import" : k;
}

/** A sensible default connection label when the owner doesn't type one. Uses the
 * account type + mask, e.g. "Imported card ····1234" / "Imported account ····9". */
export function defaultImportLabel(accountMask: string | null, accountType: string | null): string {
  const noun = /credit|card/i.test(accountType ?? "") ? "card" : "account";
  const tail = accountMask && accountMask.trim() !== "" ? ` ····${accountMask.trim()}` : "";
  return `Imported ${noun}${tail}`;
}

export { parseOfx } from "./ofx";
