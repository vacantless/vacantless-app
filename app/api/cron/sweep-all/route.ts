import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SWEEP_PATHS, summarizeSweeps, type SweepResult } from "@/lib/cron-sweeps";

// S713e: the database's 15-minute timer (pg_cron, migration 0245) calls this
// one address, and it runs every background sweep. Two ways in:
//   * Bearer CRON_SECRET (a person, or the GitHub backup), or
//   * Bearer <the database's own sweep secret>. It is generated inside the
//     database's vault and never leaves it; this route asks the database
//     whether the caller's value matches. Nobody copies a secret anywhere.
// Each sweep is then called with CRON_SECRET, exactly as GitHub calls it.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const PER_SWEEP_TIMEOUT_MS = 50_000;

async function authorized(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const presented = auth.slice("Bearer ".length).trim();
  if (!presented) return false;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && presented === cronSecret) return true;
  const admin = createAdminClient();
  if (!admin) return false;
  const { data, error } = await admin.rpc("sweep_trigger_secret_matches", { p_secret: presented });
  return !error && data === true;
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ ok: false, reason: "cron_secret_not_configured" }, { status: 200 });
  }
  const origin = req.nextUrl.origin;
  const results: SweepResult[] = await Promise.all(
    SWEEP_PATHS.map(async (path): Promise<SweepResult> => {
      const started = Date.now();
      try {
        const res = await fetch(`${origin}${path}`, {
          method: "GET",
          headers: { authorization: `Bearer ${cronSecret}` },
          cache: "no-store",
          signal: AbortSignal.timeout(PER_SWEEP_TIMEOUT_MS),
        });
        // Drain the body so the connection closes cleanly.
        await res.text().catch(() => "");
        return { path, status: res.status, ms: Date.now() - started };
      } catch (err) {
        return {
          path,
          status: null,
          ms: Date.now() - started,
          error: err instanceof Error ? err.name : "error",
        };
      }
    }),
  );
  const summary = summarizeSweeps(results);
  if (summary.failed.length > 0) console.warn("[sweep-all] failed", summary.failed);
  // S720: keep a line per run so the daily health email can see overnight
  // failures (pg_net keeps responses only a few hours). Best-effort.
  try {
    const admin = createAdminClient();
    if (admin) {
      await admin.from("sweep_runs").insert({
        ok: summary.failed.length === 0,
        ran: summary.ran,
        failed: summary.failed,
      });
      await admin
        .from("sweep_runs")
        .delete()
        .lt("ran_at", new Date(Date.now() - 14 * 86_400_000).toISOString());
    }
  } catch {
    // never fail the sweep over its own log
  }
  return NextResponse.json({ ok: summary.failed.length === 0, ...summary, results }, { status: 200 });
}
