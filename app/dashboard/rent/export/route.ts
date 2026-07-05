import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { currentUserCan } from "@/lib/membership";
import { decryptSecret } from "@/lib/crypto";
import {
  normalizeEnvironment,
  fetchTransactionReport,
  transactionsToCsv,
} from "@/lib/rotessa";

export const dynamic = "force-dynamic";

// Rent financials CSV export (platform pivot step 2, S211). Pulls the
// landlord's Rotessa transaction_report (the rent-income slice) and streams it
// back as a CSV download. Guarded on manage_rotessa. Reads status only — no
// bank data is ever in the report. Optional ?from / ?to (YYYY-MM-DD) date range
// and ?status filter are passed straight through to Rotessa.

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.redirect(new URL("/login", req.url));

  if (!(await currentUserCan("manage_rotessa"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const supabase = createClient();
  const { data } = await supabase
    .from("rotessa_accounts")
    .select("api_key_encrypted, environment")
    .eq("organization_id", org.id)
    .limit(1);
  const row = data?.[0] as { api_key_encrypted: string | null; environment: string } | undefined;
  if (!row?.api_key_encrypted) {
    return NextResponse.redirect(new URL("/dashboard/settings?rotessa=notconnected#rotessa", req.url));
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(row.api_key_encrypted);
  } catch {
    return NextResponse.redirect(new URL("/dashboard/settings?rotessa=decfail#rotessa", req.url));
  }

  const sp = req.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  const status = sp.get("status");

  // Rotessa's transaction_report requires a start_date; called without one it
  // errors, which is why the plain export link (no query params) failed with
  // ?rotessa=exportfail. Default to a wide historical window (well before any
  // Rotessa account existed) so the button works out of the box; an explicit
  // ?from still overrides. Note: the report is paginated at 1000 rows/page and
  // this pulls page 1 only — a portfolio exceeding that would need pagination.
  const defaultFrom = `${new Date().getFullYear() - 15}-01-01`;

  const result = await fetchTransactionReport(apiKey, normalizeEnvironment(row.environment), {
    startDate: from && ISO.test(from) ? from : defaultFrom,
    endDate: to && ISO.test(to) ? to : null,
    status: status || null,
  });

  if (!result.ok) {
    // Bounce back to settings with a generic error rather than dumping a body.
    return NextResponse.redirect(new URL("/dashboard/settings?rotessa=exportfail#rotessa", req.url));
  }

  const csv = transactionsToCsv(result.transactions);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="rent-payments-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
