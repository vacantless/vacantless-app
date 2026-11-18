// S816b: the phone book. Noam 2026-11-17: "phone numbers, text messages
// numbers, showing numbers, rental questions numbers, team mate text numbers,
// emergency numbers.... its a lot to find and it needs to be all easy at
// fingertips." Pure helpers; no I/O.

export type BookEntry = {
  key: string;
  name: string;
  phone: string;
  kind: "Renter" | "Applicant" | "Tenant" | "Showing agent" | "Trade" | "Teammate";
  detail: string | null;
  href: string | null;
};

/** Digits only, without a leading North American 1, for matching and dedupe. */
export function phoneKey(raw: string | null | undefined): string {
  const d = (raw ?? "").replace(/\D+/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

/** A tel:/sms: target that dials: keeps a leading +, digits and an extension. */
export function dialTarget(raw: string): string {
  const s = raw.trim();
  const ext = /(?:ext\.?|x)\s*(\d+)\s*$/i.exec(s);
  const main = (ext ? s.slice(0, ext.index) : s).replace(/[^\d+]/g, "");
  return ext ? `${main},${ext[1]}` : main;
}

/** 4165551234 / +14165551234 -> 416-555-1234; anything else stays as typed. */
export function prettyPhone(raw: string): string {
  const k = phoneKey(raw);
  if (k.length === 10 && !/ext|x\s*\d/i.test(raw)) return `${k.slice(0, 3)}-${k.slice(3, 6)}-${k.slice(6)}`;
  return raw.trim();
}

/** One row per person and number: a tenant beats an applicant beats a renter
 * with the same number, so the most current role shows. */
const RANK: Record<BookEntry["kind"], number> = {
  Tenant: 0,
  Applicant: 1,
  Renter: 2,
  "Showing agent": 3,
  Trade: 4,
  Teammate: 5,
};
export function dedupeBook(entries: BookEntry[]): BookEntry[] {
  const best = new Map<string, BookEntry>();
  for (const e of entries) {
    const k = phoneKey(e.phone);
    if (!k) continue;
    const prev = best.get(k);
    if (!prev || RANK[e.kind] < RANK[prev.kind]) best.set(k, e);
  }
  return [...best.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Search by any word of the name, the detail (address, trade) or digits of the number. */
export function matchesBook(e: BookEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D+/g, "");
  if (digits.length >= 3 && phoneKey(e.phone).includes(digits)) return true;
  const hay = `${e.name} ${e.detail ?? ""} ${e.kind}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

// Query columns for the phone book page (kept here, out of the page's copy).
export const BOOK_LEAD_COLS = "id, name, phone, status, property:properties(address)";
export const BOOK_TENANT_COLS = "id, name, phone, person_id, tenancy:tenancies(id, status, property:properties(address))";
export const BOOK_APP_COLS = "id, lead_id, applicant_name, applicant_phone, status, property:properties(address)";
