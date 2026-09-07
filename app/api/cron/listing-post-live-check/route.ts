import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { envFlagEnabled } from "@/lib/auto-listing-copy";
import {
  LIVE_CHECK_PORTALS,
  classifyListingPostLiveCheck,
  isLiveCheckPortal,
  listingPostLiveCheckTarget,
  liveCheckRowPatch,
  type LiveCheckFacts,
  type LiveCheckOutcome,
} from "@/lib/listing-post-live-check";

// Listing-post live check (S693). Fetches the public page behind every `live`
// listing_posts row on a checkable portal (Kijiji, Zumper, Rentals.ca),
// classifies it (lib/listing-post-live-check) and flips the row to `removed`
// with a dated note when the portal itself says the ad is gone. Every other
// verdict (live, challenge, needs_login, unreachable, unknown) is reported and
// leaves the row alone.
//
// DARK BY DEFAULT: writes happen only when LISTING_POST_LIVE_CHECK_ENABLED is
// on AND the call is not ?dry=1. With the flag off the route still runs in
// report-only mode so a hand call with the cron secret can measure what each
// portal answers from Vercel's egress. Not in vercel.json crons yet; add a
// schedule only after a dry run from prod has been read.
//
// Query: ?dry=1 (never write), ?post=<listing_posts.id> (one row),
// ?portal=kijiji|zumper|rentals_ca, ?limit=N (default 20, max 200).
//
// Rows are scanned newest first so a fresh hand-post is always covered; with
// more than `limit` live rows the oldest wait for a larger limit or a
// last_checked_at column (none exists; no migration before the Meta verdict).
// A run stops early at TIME_BUDGET_MS so the summary is always returned
// inside Vercel's 60 s.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 60 s is honoured on every Vercel plan; TIME_BUDGET_MS keeps a run inside it.
export const maxDuration = 60;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const FETCH_TIMEOUT_MS = 12_000;
const TIME_BUDGET_MS = 48_000;
const BODY_CAP_CHARS = 600_000;
const BETWEEN_FETCHES_MS = 750;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

type ListingPostRow = {
  id: string;
  organization_id: string;
  property_id: string;
  portal: string;
  url: string | null;
  status: string;
  notes: string | null;
  created_at: string;
};

type Detail = {
  post: string;
  portal: string;
  verdict: LiveCheckOutcome["verdict"];
  reason: string;
  requested: string | null;
  end: string | null;
  http: number | null;
  wrote: boolean;
  error?: string;
};

type Summary = {
  ok: boolean;
  reason?: string;
  mode: "write" | "dry" | "dry_flag_off";
  scanned: number;
  /** Rows the time budget left unchecked this run. */
  deferred: number;
  live: number;
  removed: number;
  challenge: number;
  needs_login: number;
  unreachable: number;
  unknown: number;
  unsupported: number;
  wrote: number;
  errors: number;
  details: Detail[];
};

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}

function safeErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? (err as { message?: unknown }).message
        : typeof err === "string"
          ? err
          : null;
  if (typeof raw !== "string" || raw.trim() === "") return "unknown";
  return raw.replace(/\s+/g, " ").trim().slice(0, 300);
}

function limitParam(req: NextRequest): number {
  const raw = Number(req.nextUrl.searchParams.get("limit"));
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(raw), MAX_LIMIT);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFacts(
  portal: string,
  url: string,
): Promise<LiveCheckFacts> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: {
        "user-agent": USER_AGENT,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-CA,en;q=0.9",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    let body: string | null = null;
    try {
      body = (await res.text()).slice(0, BODY_CAP_CHARS);
    } catch (err) {
      body = null;
      console.warn(
        `[listing-post-live-check] body read failed portal=${portal} url=${url} err=${safeErrorMessage(err)}`,
      );
    }
    return {
      portal,
      requestedUrl: url,
      // Never synthesize an end url: an empty res.url is an unmeasured case
      // and the classifiers answer `unknown` for null.
      endUrl: res.url || null,
      httpStatus: res.status,
      bodyText: body,
      fetchError: null,
    };
  } catch (err) {
    return {
      portal,
      requestedUrl: url,
      endUrl: null,
      httpStatus: null,
      bodyText: null,
      fetchError: safeErrorMessage(err),
    };
  }
}

async function loadRows(
  admin: AdminClient,
  req: NextRequest,
): Promise<ListingPostRow[]> {
  const params = req.nextUrl.searchParams;
  const onePost = params.get("post");
  const onePortal = params.get("portal");

  let query = admin
    .from("listing_posts")
    .select(
      "id, organization_id, property_id, portal, url, status, notes, created_at",
    )
    .eq("status", "live")
    .not("url", "is", null)
    .order("created_at", { ascending: false })
    .limit(limitParam(req));

  if (onePost) query = query.eq("id", onePost);
  if (onePortal) query = query.eq("portal", onePortal);
  else query = query.in("portal", [...LIVE_CHECK_PORTALS]);

  const { data, error } = await query;
  if (error) throw new Error(`listing_posts_query:${error.message}`);
  return (data ?? []) as ListingPostRow[];
}

function bump(summary: Summary, verdict: LiveCheckOutcome["verdict"]) {
  summary[verdict] += 1;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const enabled = envFlagEnabled(process.env.LISTING_POST_LIVE_CHECK_ENABLED);
  const dryParam = req.nextUrl.searchParams.get("dry") === "1";
  const mode: Summary["mode"] = !enabled ? "dry_flag_off" : dryParam ? "dry" : "write";
  const write = mode === "write";

  const summary: Summary = {
    ok: true,
    mode,
    scanned: 0,
    deferred: 0,
    live: 0,
    removed: 0,
    challenge: 0,
    needs_login: 0,
    unreachable: 0,
    unknown: 0,
    unsupported: 0,
    wrote: 0,
    errors: 0,
    details: [],
  };

  const portalParam = req.nextUrl.searchParams.get("portal");
  if (portalParam && !isLiveCheckPortal(portalParam)) {
    return NextResponse.json(
      { ...summary, ok: false, reason: "portal_not_checkable" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { ...summary, ok: false, reason: "admin_client_unavailable" },
      { status: 500 },
    );
  }

  let rows: ListingPostRow[];
  try {
    rows = await loadRows(admin, req);
  } catch (err) {
    return NextResponse.json(
      { ...summary, ok: false, reason: safeErrorMessage(err) },
      { status: 500 },
    );
  }

  const nowISO = new Date().toISOString();
  const started = Date.now();

  for (let i = 0; i < rows.length; i++) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      summary.deferred = rows.length - i;
      summary.reason = "time_budget";
      break;
    }
    const row = rows[i];
    summary.scanned++;

    const target = listingPostLiveCheckTarget(row.portal, row.url);
    if (!target) {
      const outcome: LiveCheckOutcome = {
        verdict: "unsupported",
        reason: "url_shape_not_checkable",
        evidence: null,
      };
      bump(summary, outcome.verdict);
      summary.details.push({
        post: row.id,
        portal: row.portal,
        verdict: outcome.verdict,
        reason: outcome.reason,
        requested: row.url,
        end: null,
        http: null,
        wrote: false,
      });
      continue;
    }

    if (i > 0) await sleep(BETWEEN_FETCHES_MS);
    const facts = await fetchFacts(row.portal, target.url);
    const outcome = classifyListingPostLiveCheck(facts, target);
    bump(summary, outcome.verdict);

    const detail: Detail = {
      post: row.id,
      portal: row.portal,
      verdict: outcome.verdict,
      reason: outcome.reason,
      requested: target.url,
      end: facts.endUrl,
      http: facts.httpStatus,
      wrote: false,
    };

    const patch = liveCheckRowPatch(row, outcome, nowISO);
    if (patch && write) {
      // Guarded on status: the row must still be `live` at write time. A note
      // edited by hand in the same minute would be re-appended to from the
      // scan-time copy; status is the fact the guard protects.
      const { data: updated, error: updErr } = await admin
        .from("listing_posts")
        .update(patch)
        .eq("id", row.id)
        .eq("status", "live")
        .select("id");
      if (updErr) {
        summary.errors++;
        detail.error = safeErrorMessage(updErr);
      } else if ((updated ?? []).length > 0) {
        summary.wrote++;
        detail.wrote = true;
      } else {
        detail.error = "row_no_longer_live_at_write";
      }
    }

    console.log(
      `[listing-post-live-check] post=${row.id} portal=${row.portal} verdict=${outcome.verdict} reason=${outcome.reason} http=${facts.httpStatus ?? "none"} end=${facts.endUrl ?? "none"} mode=${mode} wrote=${detail.wrote ? "1" : "0"}`,
    );
    summary.details.push(detail);
  }

  return NextResponse.json(summary);
}
