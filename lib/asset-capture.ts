// ============================================================================
// Asset capture — the PURE parse contract for photo/receipt -> structured fields
// (S364, "photo-OCR / email-in capture", the differentiating Unit-Bible UX).
//
// PURPOSE: turn a phone photo of an appliance DATA PLATE (or a purchase RECEIPT)
// into the fields the appliance record + the expense ledger already understand,
// so capture is a ~10-second phone action instead of an 8-field desk form. The
// extraction is delegated to a multimodal model in lib/asset-capture-vision.ts
// (the impure, network half); THIS module is the deterministic contract around
// it — the JSON schema the model must return, the prompt, and the normalizer
// that coerces the model's raw JSON into safe, typed fields. No DB / env / I/O,
// so it unit-tests cleanly via `npx tsx scripts/test-asset-capture.ts`.
//
// FORWARD-COMPATIBLE BY DESIGN (Noam, S364: "this flows to both the expenses and
// the Bible, correct?"). One capture, one engine, three destinations: the Unit
// Bible asset record (now), the building dossier (an aggregate read), and the
// per-unit/building EXPENSE ledger (receipt mode, later). So the parse result is
// a DISCRIMINATED UNION: a "plate" extraction (appliance/Bible fields) OR a
// "receipt" extraction (expense fields). Phase 1 consumes the plate subset; the
// receipt branch is already typed so the expense routing slots in without a
// rewrite. The model classifies which it saw and fills the matching branch.
//
// DATA-SOURCE DISCIPLINE: this only interprets bytes the landlord chose to
// capture — their OWN appliance plate / their OWN store receipt. No board-
// licensed data, no scrape, none of the MLS email-in compliance gate. The image
// is sent to the parse call transiently and (Phase 1) NOT stored; no tenant PII.
// ============================================================================

import { APPLIANCE_TYPES, type ApplianceType } from "./appliance-care";

// ---------------------------------------------------------------------------
// Bounds (mirror the appliance form's own clamps in
// app/dashboard/properties/actions.ts::applianceFieldsFromForm so a scanned
// draft can never carry a value the manual form would reject).
// ---------------------------------------------------------------------------
export const MIN_INSTALL_YEAR = 1950;
export const MAX_INSTALL_YEAR = 2100;
export const MIN_WARRANTY_MONTHS = 1;
export const MAX_WARRANTY_MONTHS = 600;
/** Recommended-replacement interval bounds — match the appliance form's
 * consumable_interval_months clamp so a scanned schedule can seed the existing
 * recurring-consumable trigger without the form rejecting it (S364, Noam). */
export const MIN_CONSUMABLE_MONTHS = 1;
export const MAX_CONSUMABLE_MONTHS = 120;
/** Trim ceiling for any free-text field the model returns (make/model/serial). */
export const MAX_TEXT_LEN = 120;
/** Sanity ceiling on a parsed receipt total, in cents ($1,000,000). */
export const MAX_TOTAL_CENTS = 100_000_000;

// ---------------------------------------------------------------------------
// The result contract (discriminated union)
// ---------------------------------------------------------------------------

/** A manufacturer-recommended replacement directive read off the plate / manual
 * (e.g. "water filter, every 6 months"). Feeds the existing recurring-consumable
 * trigger (consumable_label + consumable_interval_months, S362). The contract
 * carries a LIST (a manual can recommend several) for forward-compatibility; the
 * Phase-1 form seeds the single primary one. Confirm-not-assert: this is a
 * prefill the landlord reviews, never an authoritative schedule. */
export interface ConsumableRec {
  label: string;
  interval_months: number;
}

/** Appliance/Bible fields read off a data plate. A subset of the appliance form
 * (the fields a nameplate actually carries); everything is nullable because a
 * plate may show only some of them and the model must null what it can't read.
 * `recommended_consumables` is the maker's replacement schedule (S364). */
export interface PlateDraft {
  kind: "plate";
  appliance_type: ApplianceType | null;
  make: string | null;
  model: string | null;
  serial: string | null;
  install_year: number | null;
  warranty_months: number | null;
  recommended_consumables: ConsumableRec[];
}

/** Expense fields read off a purchase receipt (receipt mode — Phase 2/4 feeds
 * these to the per-unit/building expense ledger). Typed now so the contract is
 * forward-compatible; Phase 1 doesn't render these but must not choke on them. */
export interface ReceiptDraft {
  kind: "receipt";
  merchant: string | null;
  purchase_date: string | null; // ISO 'YYYY-MM-DD'
  total_cents: number | null;
  // A receipt often names the appliance too — carry the same plate fields so a
  // single receipt scan can BOTH file the expense and prefill the asset record.
  appliance_type: ApplianceType | null;
  make: string | null;
  model: string | null;
  serial: string | null;
  recommended_consumables: ConsumableRec[];
}

export type AssetDraft = PlateDraft | ReceiptDraft;

/** The outcome the vision adapter returns. `empty` = parsed but nothing useful
 * was read (all fields null) — the UI should say "couldn't read it, enter
 * manually" rather than open a blank-but-"scanned" form. */
export type AssetParseResult =
  | { ok: true; draft: AssetDraft }
  | { ok: false; reason: "unconfigured" | "failed" | "empty" };

// ---------------------------------------------------------------------------
// The prompt (kept here so the contract + the wording are versioned together)
// ---------------------------------------------------------------------------

export const EXTRACTION_SYSTEM_PROMPT =
  "You read a single photo a landlord took of either (a) an appliance DATA PLATE " +
  "/ nameplate sticker, or (b) a purchase RECEIPT or invoice for a home appliance. " +
  "Extract only what is clearly legible. NEVER guess: if a value is unreadable or " +
  "absent, use null. Reply with ONE JSON object and nothing else — no prose, no " +
  "markdown fences.";

/** The instruction sent alongside the image. Describes the exact JSON shape for
 * each branch so the model's output maps 1:1 onto normalizeAssetDraft. */
export function buildExtractionPrompt(): string {
  return [
    "Decide whether the photo is a data PLATE or a RECEIPT, then return JSON.",
    "",
    'If a PLATE: {"kind":"plate","appliance_type":<one of ' +
      APPLIANCE_TYPES.join("|") +
      ' or null>,"make":<brand or null>,"model":<model number or null>,' +
      '"serial":<serial number or null>,"install_year":<4-digit year or null>,' +
      '"warranty_months":<integer months or null>,"recommended_consumables":[]}',
    "",
    'If a RECEIPT: {"kind":"receipt","merchant":<store name or null>,' +
      '"purchase_date":<YYYY-MM-DD or null>,"total_cents":<integer cents or null>,' +
      '"appliance_type":<one of the types above or null>,"make":<brand or null>,' +
      '"model":<model or null>,"serial":<serial or null>,"recommended_consumables":[]}',
    "",
    'recommended_consumables: if the plate/manual states a replacement schedule ' +
      '(e.g. "replace water filter every 6 months"), list each as ' +
      '{"label":<short name>,"interval_months":<integer>}. Otherwise [].',
    "",
    "Rules: appliance_type must be EXACTLY one of the listed words or null. " +
      "Money as integer cents (e.g. $1,299.99 -> 129999). Year as a 4-digit " +
      "integer. Output the JSON object only.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Tolerant JSON extraction (models sometimes wrap JSON in prose / ``` fences)
// ---------------------------------------------------------------------------

/** Pull the first balanced {...} object out of a model reply and JSON.parse it.
 * Returns null on anything unparseable. Brace-counts so a nested object inside
 * the value doesn't truncate early. */
export function extractJsonObject(text: unknown): Record<string, unknown> | null {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          const parsed = JSON.parse(slice);
          return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Field coercion helpers (each null-safe; the only logic worth testing)
// ---------------------------------------------------------------------------

function cleanText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ").slice(0, MAX_TEXT_LEN).trim();
  if (!t) return null;
  // Models sometimes emit the string "null"/"n/a"/"unknown" instead of JSON null.
  if (/^(null|n\/a|na|none|unknown|unreadable|-)$/i.test(t)) return null;
  return t;
}

function clampInt(v: unknown, min: number, max: number): number | null {
  const n =
    typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[, ]/g, "")) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  if (i < min || i > max) return null;
  return i;
}

function cleanApplianceType(v: unknown): ApplianceType | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  return (APPLIANCE_TYPES as readonly string[]).includes(t) ? (t as ApplianceType) : null;
}

/** Coerce a raw recommended-consumable list into clean {label, interval_months}
 * entries, dropping anything without both a label and an in-range interval.
 * Tolerates a single object instead of an array, and `months`/`every_months`
 * aliases for the interval. */
function cleanConsumables(v: unknown): ConsumableRec[] {
  const arr = Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [];
  const out: ConsumableRec[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const label = cleanText(o.label ?? o.name ?? o.what);
    const interval = clampInt(
      o.interval_months ?? o.months ?? o.every_months ?? o.interval,
      MIN_CONSUMABLE_MONTHS,
      MAX_CONSUMABLE_MONTHS,
    );
    if (label && interval != null) out.push({ label, interval_months: interval });
  }
  return out;
}

/** Coerce a model value to an ISO 'YYYY-MM-DD' or null. Accepts an already-ISO
 * string; rejects anything that isn't a real calendar date. */
function cleanIsoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const yr = Number(y);
  const mon = Number(mo);
  const day = Number(d);
  if (yr < MIN_INSTALL_YEAR || yr > MAX_INSTALL_YEAR) return null;
  if (mon < 1 || mon > 12) return null;
  if (day < 1 || day > 31) return null;
  return `${y}-${mo}-${d}`;
}

// ---------------------------------------------------------------------------
// The normalizer — raw model JSON -> a safe, typed AssetDraft (or null)
// ---------------------------------------------------------------------------

/**
 * Coerce a parsed JSON object into an AssetDraft, clamping every field to the
 * same bounds the manual appliance form enforces and discarding junk. Returns
 * null when the object isn't usable at all. The `kind` defaults to "plate" when
 * absent/odd (the common case) UNLESS receipt-only signals (merchant/total) are
 * present, so a model that forgets `kind` still routes sensibly.
 */
export function normalizeAssetDraft(raw: unknown): AssetDraft | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const kindRaw = typeof o.kind === "string" ? o.kind.trim().toLowerCase() : "";
  const looksReceipt =
    kindRaw === "receipt" || o.merchant != null || o.total_cents != null || o.total != null;

  const consumables = cleanConsumables(o.recommended_consumables ?? o.consumables);

  if (looksReceipt) {
    return {
      kind: "receipt",
      merchant: cleanText(o.merchant),
      purchase_date: cleanIsoDate(o.purchase_date),
      total_cents: clampInt(o.total_cents ?? o.total, 1, MAX_TOTAL_CENTS),
      appliance_type: cleanApplianceType(o.appliance_type),
      make: cleanText(o.make),
      model: cleanText(o.model),
      serial: cleanText(o.serial),
      recommended_consumables: consumables,
    };
  }

  return {
    kind: "plate",
    appliance_type: cleanApplianceType(o.appliance_type),
    make: cleanText(o.make),
    model: cleanText(o.model),
    serial: cleanText(o.serial),
    install_year: clampInt(o.install_year ?? o.year, MIN_INSTALL_YEAR, MAX_INSTALL_YEAR),
    warranty_months: clampInt(o.warranty_months, MIN_WARRANTY_MONTHS, MAX_WARRANTY_MONTHS),
    recommended_consumables: consumables,
  };
}

/** The primary recommended consumable (the one Phase-1 seeds into the single
 * consumable trigger), or null. */
export function primaryConsumable(d: AssetDraft | null): ConsumableRec | null {
  return d?.recommended_consumables?.[0] ?? null;
}

/** True when a draft carries no usable field (so the UI should fall back to a
 * manual entry rather than a misleadingly-"scanned" empty form). */
export function isEmptyDraft(d: AssetDraft | null): boolean {
  if (!d) return true;
  const hasConsumable = d.recommended_consumables.length > 0;
  if (d.kind === "plate") {
    return !(
      d.appliance_type ||
      d.make ||
      d.model ||
      d.serial ||
      d.install_year != null ||
      d.warranty_months != null ||
      hasConsumable
    );
  }
  return !(
    d.merchant ||
    d.purchase_date ||
    d.total_cents != null ||
    d.appliance_type ||
    d.make ||
    d.model ||
    d.serial ||
    hasConsumable
  );
}

// ---------------------------------------------------------------------------
// Round-trip a draft through the URL (scan action redirects -> the unit page
// reads the prefill). Only the appliance/plate subset the Phase-1 add-form uses
// is carried; receipt-only fields are not needed for the prefill yet.
// ---------------------------------------------------------------------------

/** Compact, namespaced query params for the appliance prefill. */
export function plateFieldsToQuery(d: AssetDraft): Record<string, string> {
  const out: Record<string, string> = {};
  if (d.appliance_type) out.sc_type = d.appliance_type;
  if (d.make) out.sc_make = d.make;
  if (d.model) out.sc_model = d.model;
  if (d.serial) out.sc_serial = d.serial;
  if (d.kind === "plate") {
    if (d.install_year != null) out.sc_year = String(d.install_year);
    if (d.warranty_months != null) out.sc_warranty = String(d.warranty_months);
  }
  const c = primaryConsumable(d);
  if (c) {
    out.sc_clabel = c.label;
    out.sc_cmonths = String(c.interval_months);
  }
  return out;
}

/** The prefill the unit page hands the Add-appliance form, rebuilt from the
 * scan-redirect query params (re-clamped so a hand-edited URL can't inject junk). */
export interface AppliancePrefill {
  appliance_type: ApplianceType | null;
  make: string | null;
  model: string | null;
  serial: string | null;
  install_year: number | null;
  warranty_months: number | null;
  consumable_label: string | null;
  consumable_interval_months: number | null;
}

export function appliancePrefillFromQuery(
  params: Record<string, string | string[] | undefined>,
): AppliancePrefill | null {
  const one = (k: string): string | undefined => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const prefill: AppliancePrefill = {
    appliance_type: cleanApplianceType(one("sc_type")),
    make: cleanText(one("sc_make")),
    model: cleanText(one("sc_model")),
    serial: cleanText(one("sc_serial")),
    install_year: clampInt(one("sc_year"), MIN_INSTALL_YEAR, MAX_INSTALL_YEAR),
    warranty_months: clampInt(one("sc_warranty"), MIN_WARRANTY_MONTHS, MAX_WARRANTY_MONTHS),
    consumable_label: cleanText(one("sc_clabel")),
    consumable_interval_months: clampInt(
      one("sc_cmonths"),
      MIN_CONSUMABLE_MONTHS,
      MAX_CONSUMABLE_MONTHS,
    ),
  };
  const empty =
    !prefill.appliance_type &&
    !prefill.make &&
    !prefill.model &&
    !prefill.serial &&
    prefill.install_year == null &&
    prefill.warranty_months == null &&
    !prefill.consumable_label &&
    prefill.consumable_interval_months == null;
  return empty ? null : prefill;
}
