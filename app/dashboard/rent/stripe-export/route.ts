import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { currentUserCan } from "@/lib/membership";
import { getStripe } from "@/lib/stripe";
import {
  normalizeStripeInvoice,
  stripeInvoicesToCsv,
  type RawStripeInvoice,
} from "@/lib/stripe-connect";

export const dynamic = "force-dynamic";

// Stripe rent invoices CSV export (platform pivot step 2, ALT provider,
// increment 5; S218). Sibling of the Rotessa transaction_report export
// (app/dashboard/rent/export/route.ts) — lists the rent invoices Stripe
// generated on the LANDLORD's connected account (the rent-income slice) and
// streams them back as a CSV download. Guarded on manage_rent. We never read or
// store bank data — invoices carry amounts + status only, and all calls carry
// the Stripe-Account header (direct charges on the connected account).
//
// Optional ?from / ?to (YYYY-MM-DD) bound the invoice `created` window and
// ?status (paid|open|void|uncollectible|draft) filters by invoice status.

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const INVOICE_STATUSES = new Set(["draft", "open", "paid", "uncollectible", "void"]);

/** YYYY-MM-DD -> Unix seconds at 00:00 UTC. null if malformed. */
function isoToUnixStart(iso: string | null): number | null {
  if (!iso || !ISO.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

export async function GET(req: NextRequest) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.redirect(new URL("/login", req.url));

  if (!(await currentUserCan("manage_rent"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.redirect(new URL("/dashboard/settings?striperent=notconfigured#stripe", req.url));
  }

  const supabase = createClient();
  const { data } = await supabase
    .from("stripe_connect_accounts")
    .select("connected_account_id")
    .eq("organization_id", org.id)
    .limit(1);
  const stripeAccount = (data?.[0] as { connected_account_id: string } | undefined)?.connected_account_id;
  if (!stripeAccount) {
    return NextResponse.redirect(new URL("/dashboard/settings?striperent=notconnected#stripe", req.url));
  }

  const sp = req.nextUrl.searchParams;
  const fromUnix = isoToUnixStart(sp.get("from"));
  const toUnix = isoToUnixStart(sp.get("to"));
  const statusParam = sp.get("status");
  const status = statusParam && INVOICE_STATUSES.has(statusParam) ? statusParam : null;

  const created: Record<string, number> = {};
  if (fromUnix != null) created.gte = fromUnix;
  if (toUnix != null) created.lte = toUnix + 86399; // include the whole end day

  const listParams: Record<string, unknown> = { limit: 100 };
  if (status) listParams.status = status;
  if (Object.keys(created).length) listParams.created = created;

  const rows: RawStripeInvoice[] = [];
  try {
    // Page through all matching invoices on the connected account.
    const iter = stripe.invoices
      .list(listParams, { stripeAccount })
      .autoPagingEach((inv: unknown) => {
        rows.push(inv as RawStripeInvoice);
      });
    await iter;
  } catch {
    return NextResponse.redirect(new URL("/dashboard/settings?striperent=exportfail#stripe", req.url));
  }

  const csv = stripeInvoicesToCsv(rows.map(normalizeStripeInvoice));
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="stripe-rent-invoices-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
