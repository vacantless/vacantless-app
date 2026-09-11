import { NextResponse } from "next/server";
import { getCurrentOrg } from "@/lib/org";
import { planEntitlements } from "@/lib/billing";
import { investmentPackageToCsv } from "@/lib/investment-package";
import { rangeForPreset, parseRangeBound, type DateRange } from "@/lib/statements";
import { loadInvestmentPackage } from "../load";

export const dynamic = "force-dynamic";

function parsePriceDollars(raw: string | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const dollars = Number(cleaned);
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  return Math.round(dollars * 100);
}

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "building";
}

export async function GET(request: Request) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "no_org" }, { status: 401 });
  if (!planEntitlements(org.plan).accounting) {
    return NextResponse.json({ error: "not_entitled" }, { status: 403 });
  }

  const url = new URL(request.url);
  const preset = url.searchParams.get("preset") ?? "this_year";
  const asOf = new Date().toISOString().slice(0, 10);
  const range: DateRange = rangeForPreset(preset, asOf, {
    from: parseRangeBound(url.searchParams.get("from")),
    to: parseRangeBound(url.searchParams.get("to")),
  });
  const requested = url.searchParams.get("building");

  const { pkg } = await loadInvestmentPackage(
    org.id,
    range,
    asOf,
    requested && requested.length > 0 ? requested : null,
    parsePriceDollars(url.searchParams.get("price")),
  );
  if (!pkg) return NextResponse.json({ error: "no_building" }, { status: 404 });

  return new NextResponse(investmentPackageToCsv(pkg), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="investment-package-${slug(pkg.label)}-${asOf}.csv"`,
    },
  });
}
