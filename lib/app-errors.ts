// S748: one place for the crash-report rules (pure, tested in
// scripts/test-s748-honest-sweeps.ts). The browser posts what the error page
// knows; everything is capped before it reaches the table, and query strings
// are dropped so a signed link never lands in the log.

export const APP_ERROR_LIMIT = { window: 600, limit: 20 } as const; // per connection

export type AppErrorRow = { path: string | null; digest: string | null; message: string | null; kind: string };

function clip(v: unknown, n: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f]+/g, " ").trim();
  return s ? s.slice(0, n) : null;
}

/** Clean one report from the browser. Returns null when there is nothing to keep. Pure. */
export function cleanAppError(body: unknown): AppErrorRow | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  let path = clip(b.path, 200);
  if (path) path = path.split("?")[0].split("#")[0] || "/";
  const digest = clip(b.digest, 64);
  const message = clip(b.message, 300);
  const kind = b.kind === "global" ? "global" : "page";
  if (!path && !digest && !message) return null;
  return { path, digest, message, kind };
}

/** Group a day's rows by page for the health email, most first. Pure. */
export function appErrorLines(rows: { path: string | null }[], max = 8): string[] {
  const by = new Map<string, number>();
  for (const r of rows) {
    // /r/<id> and /dashboard/properties/<id> group by shape, not by rental.
    const p = (r.path ?? "unknown").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>");
    by.set(p, (by.get(p) ?? 0) + 1);
  }
  return [...by.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([p, n]) => `${p}: ${n} crash${n === 1 ? "" : "es"}.`);
}
