// S742g: the renter list on a rental. Open requests first, one line per
// person (the same renter asking twice shows once with a count), and the
// closed ones (leased, lost) folded away under a count. Pure.
import { stagesForSegment } from "./pipeline";

export type RenterRowIn = { id: string; name: string | null; email: string | null; phone?: string | null; status: string; created_at: string };
export type RenterRowOut<T extends RenterRowIn> = { row: T; requests: number };

function emailKey(r: RenterRowIn): string | null {
  const e = (r.email ?? "").trim().toLowerCase();
  return e || null;
}
function phoneKey(r: RenterRowIn): string | null {
  const digits = (r.phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}
function nameKey(r: RenterRowIn): string | null {
  const n = (r.name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return n || null;
}

/**
 * Rows arrive newest first. Open rows are grouped by person (newest kept,
 * count of requests), closed rows are listed as they are. The same person is
 * recognised by the same email, the same phone (last ten digits) or the same
 * name, so a renter who wrote twice from two addresses (S742: Avani, Agile)
 * is one line.
 */
export function groupRenterRows<T extends RenterRowIn>(rows: T[]): { open: RenterRowOut<T>[]; closed: T[] } {
  const closedStages = new Set<string>(stagesForSegment("closed") as readonly string[]);
  const open: RenterRowOut<T>[] = [];
  const closed: T[] = [];
  const groups: { out: RenterRowOut<T>; emails: Set<string>; phones: Set<string>; names: Set<string> }[] = [];
  for (const r of rows) {
    if (closedStages.has(r.status)) {
      closed.push(r);
      continue;
    }
    const e = emailKey(r);
    const ph = phoneKey(r);
    const n = nameKey(r);
    const hit = groups.find(
      (g) => (e && g.emails.has(e)) || (ph && g.phones.has(ph)) || (n && g.names.has(n)),
    );
    if (hit) {
      hit.out.requests += 1;
      if (e) hit.emails.add(e);
      if (ph) hit.phones.add(ph);
      if (n) hit.names.add(n);
      continue;
    }
    const out = { row: r, requests: 1 };
    groups.push({ out, emails: new Set(e ? [e] : []), phones: new Set(ph ? [ph] : []), names: new Set(n ? [n] : []) });
    open.push(out);
  }
  return { open, closed };
}
