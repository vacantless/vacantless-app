import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  SWEEP_PATHS,
  failedPath,
  repeatFailures,
  summarizeSweeps,
  sweepDetails,
  type SweepResult,
} from "@/lib/cron-sweeps";
import { sendNotificationEmail } from "@/lib/email";
import { adminEmails } from "@/lib/provisioning-server";
import { torontoDateHour } from "@/lib/health-digest";

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
        // S728: keep what the sweep answered. A flag that is off returns 200
        // with reason "disabled", which used to vanish here.
        const text = await res.text().catch(() => "");
        let reason: string | null = null;
        let sent: number | null = null;
        let bodyOk: boolean | null = null;
        try {
          const body = JSON.parse(text) as { reason?: unknown; sent?: unknown; ok?: unknown; error?: unknown };
          if (typeof body.reason === "string") reason = body.reason;
          // S748: many sweeps answer 200 { ok: false, error } on a query error.
          else if (typeof body.error === "string") reason = body.error;
          if (typeof body.sent === "number") sent = body.sent;
          if (typeof body.ok === "boolean") bodyOk = body.ok;
        } catch {
          // not JSON
        }
        return { path, status: res.status, ms: Date.now() - started, reason, sent, bodyOk };
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
      // S748: the run before this one, to spot a sweep failing twice in a row.
      const { data: prevRun } = await admin
        .from("sweep_runs")
        .select("failed")
        .order("ran_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      await admin.from("sweep_runs").insert({
        ok: summary.failed.length === 0,
        ran: summary.ran,
        failed: summary.failed,
        // S736: the server Node rides along so a daily check can see the security fix land.
        details: {
          ...sweepDetails(results),
          "server-node": { status: null, reason: process.version },
          ...(summary.slow.length ? { "slow-sweeps": { status: null, reason: summary.slow.join(",").slice(0, 160) } } : {}),
        },
      });
      await alertRepeatFailures(admin, summary.failed, (prevRun as { failed: string[] | null } | null)?.failed ?? null, results);
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

/**
 * S748: email the admins at once when a sweep fails two runs in a row, at most
 * once per sweep per Toronto day (platform_digest_runs is the claim). The 8 AM
 * health email still lists everything; this is for "a renter reminder did not
 * go out half an hour ago", not tomorrow morning. Best-effort.
 */
async function alertRepeatFailures(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  failed: string[],
  previous: string[] | null,
  results: SweepResult[],
): Promise<void> {
  const paths = repeatFailures(failed, previous);
  if (paths.length === 0) return;
  const today = torontoDateHour(new Date()).date;
  const recipients = adminEmails();
  const to = recipients.length > 0 ? recipients : ["hello@vacantless.com"];
  for (const path of paths) {
    const name = path.replace("/api/cron/", "");
    const { error: claimErr } = await admin
      .from("platform_digest_runs")
      .insert({ digest: `sweep-alert:${name}`, sent_on: today });
    if (claimErr) continue; // already emailed about this sweep today
    const r = results.find((x) => x.path === path);
    const what =
      r?.status == null
        ? `It did not answer (${r?.error ?? "no response"}).`
        : `It answered ${r.status}${r.reason ? ` with "${r.reason.slice(0, 160)}"` : ""}.`;
    const entry = failed.find((f) => failedPath(f) === path) ?? path;
    for (const addr of to) {
      await sendNotificationEmail({
        to_email: addr,
        subject: `Vacantless: the ${name} sweep failed twice in a row`,
        body: [
          `The ${name} background sweep failed in the last two runs (about 30 minutes). ${what}`,
          `Run entry: ${entry}. This email goes out once a day per sweep; the 8 AM health email lists every failure.`,
        ].join("\n\n"),
        org_name: "Vacantless",
        brand_color: null,
        logo_url: null,
        reply_to_email: null,
      }).catch(() => undefined);
    }
  }
}
