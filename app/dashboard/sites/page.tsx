import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Icons } from "@/components/icons";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { isHiddenForOrg } from "@/lib/posting-lanes";
import { POSTING_ADDON_HREF } from "@/lib/billing";
import { readRobotPostingAccess } from "@/lib/robot-posting-access";
import { cleanPropertyId } from "@/lib/site-signin";
import { signinChainHref } from "@/lib/sites-setup";
import { listChannelTileStatuses } from "@/app/dashboard/properties/actions";
import { SitesRows } from "./sites-rows";

export const dynamic = "force-dynamic";

// S760: "Connect your rental sites", the one-time setup step. Five rows, one
// state each (On, Needs you, Checking, With Posting), one progress line, one
// button that chains the three sign-in windows. The detailed per-site page
// (/dashboard/link-portals) stays for account settings and checks.
export default async function SitesSetupPage({
  searchParams,
}: {
  searchParams: { property?: string; from?: string };
}) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const supabase = createClient();

  let propertyId: string | null = null;
  let propertyAddress: string | null = null;
  const wanted = cleanPropertyId(searchParams.property);
  if (wanted) {
    const { data: owned } = await supabase
      .from("properties")
      .select("id, address")
      .eq("id", wanted)
      .eq("organization_id", org.id)
      .maybeSingle();
    if (owned?.id) {
      propertyId = owned.id as string;
      propertyAddress = (owned.address as string | null) ?? null;
    }
  }

  const [tiles, access] = await Promise.all([
    listChannelTileStatuses(org.id),
    readRobotPostingAccess(supabase, org.id),
  ]);
  const tileStateByChannel: Record<string, string> = {};
  for (const t of tiles) tileStateByChannel[t.channel] = t.state;
  // Hidden sites never reach the client; the pure builder gets a plain map.
  for (const k of Object.keys(tileStateByChannel)) {
    if (isHiddenForOrg(k, org.id)) delete tileStateByChannel[k];
  }

  const backHref = propertyId
    ? `/dashboard/properties/${propertyId}?tab=distribute#distribute-header`
    : searchParams.from === "getting-started"
      ? "/dashboard/getting-started"
      : "/dashboard";

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={backHref} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
        ← {propertyAddress ?? (searchParams.from === "getting-started" ? "Getting started" : "Today")}
      </Link>
      <PageHeader
        icon={<Icons.check />}
        eyebrow="Set up once"
        title="Connect your rental sites"
        subtitle="Sign in to each site one time. After that, post a rental and it goes up everywhere. We keep the ads up and take them down when it rents."
      />
      {!access.allowed ? (
        <p className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          Your Facebook Page and Marketplace are free for every account. Kijiji, Rentals.ca and Zumper are posted for you
          with Posting, $49 a month.{" "}
          <Link href={POSTING_ADDON_HREF} className="font-semibold text-brand">
            See Posting
          </Link>
        </p>
      ) : null}
      <div className="mt-5">
        <SitesRows
          input={{
            tileStateByChannel,
            postingAllowed: access.allowed,
            propertyId,
            postingHref: POSTING_ADDON_HREF,
          }}
          signinAllHref={access.allowed ? signinChainHref(propertyId) : null}
        />
      </div>
      <p className="mt-6 text-xs text-gray-500">
        Account details, checks and &quot;forget this sign-in&quot; are on{" "}
        <Link href="/dashboard/link-portals" className="underline">
          your sites page
        </Link>
        .
      </p>
    </div>
  );
}
