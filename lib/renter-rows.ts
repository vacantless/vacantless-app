// S742g: the renter list on a rental. Open requests first, one line per
// person (the same renter asking twice shows once with a count), and the
// closed ones (leased, lost) folded away under a count. Pure.
import { stagesForSegment } from "./pipeline";

export type RenterRowIn = { id: string; name: string | null; email: string | null; status: string; created_at: string };
export type RenterRowOut<T extends RenterRowIn> = { row: T; requests: number };

function personKey(r: RenterRowIn): string {
  const email = (r.email ?? "").trim().toLowerCase();
  if (email) return `e:${email}`;
  const name = (r.name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return name ? `n:${name}` : `id:${r.id}`;
}

/**
 * Rows arrive newest first. Open rows are grouped by person (newest kept,
 * count of requests), closed rows are listed as they are.
 */
export function groupRenterRows<T extends RenterRowIn>(rows: T[]): { open: RenterRowOut<T>[]; closed: T[] } {
  const closedStages = new Set<string>(stagesForSegment("closed") as readonly string[]);
  const open: RenterRowOut<T>[] = [];
  const closed: T[] = [];
  const seen = new Map<string, RenterRowOut<T>>();
  for (const r of rows) {
    if (closedStages.has(r.status)) {
      closed.push(r);
      continue;
    }
    const key = personKey(r);
    const hit = seen.get(key);
    if (hit) {
      hit.requests += 1;
      continue;
    }
    const out = { row: r, requests: 1 };
    seen.set(key, out);
    open.push(out);
  }
  return { open, closed };
}
