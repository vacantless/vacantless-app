// S803: one email per batch of crew taps, not one per tap. A tap that needs
// the landlord (lib/unit-progress-notify TAP_NOTIFY_STAGES) is held as a line
// on its event; the 15-minute sweep sends one email per crew member once they
// have stopped tapping for QUIET_MS. Rented still emails at once (its ads come
// down and a mistake should be caught quickly). Pure; scripts/test-unit-progress-digest.ts.

export const QUIET_MS = 5 * 60 * 1000;

export type PendingTap = {
  id: string;
  organizationId: string;
  crewMemberId: string | null;
  propertyId: string;
  line: string;
  createdAt: string;
};

export type DigestBatch = {
  organizationId: string;
  crewMemberId: string | null;
  eventIds: string[];
  propertyIds: string[];
  lines: string[];
};

/** Batches whose newest tap is at least QUIET_MS old, oldest tap first. */
export function readyDigests(rows: PendingTap[], now: Date, quietMs = QUIET_MS): DigestBatch[] {
  const groups = new Map<string, PendingTap[]>();
  for (const r of rows) {
    const key = `${r.organizationId}|${r.crewMemberId ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: DigestBatch[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const newest = Date.parse(list[list.length - 1].createdAt);
    if (!Number.isFinite(newest) || now.getTime() - newest < quietMs) continue;
    // Only the latest tap per unit counts: tapping Ready for photos then
    // Photos are in on the same unit reads as one line.
    const latest = new Map<string, PendingTap>();
    for (const r of list) latest.set(r.propertyId, r);
    const kept = list.filter((r) => latest.get(r.propertyId) === r);
    out.push({
      organizationId: list[0].organizationId,
      crewMemberId: list[0].crewMemberId,
      eventIds: list.map((r) => r.id),
      propertyIds: kept.map((r) => r.propertyId),
      lines: kept.map((r) => r.line),
    });
  }
  return out;
}

/** "5 units" or the one unit's line, for the email. */
export function digestCountLabel(n: number): string {
  return n === 1 ? "1 unit" : `${n} units`;
}

/** The line kept for one held tap: "833 Pillette Rd, Unit 3: Photos are in. ..." */
export function tapLine(address: string, stageLabel: string, extra: string): string {
  const head = `${address.split(",").slice(0, 2).join(",").trim()}: ${stageLabel}.`;
  return extra.trim() ? `${head} ${extra.trim()}` : head;
}

/** "It already has 14 photos, so nothing new was pulled." for a unit with photos and no folder. */
export function photosAlreadyLine(count: number): string {
  return `It already has ${count} photo${count === 1 ? "" : "s"}, so nothing new was pulled.`;
}
