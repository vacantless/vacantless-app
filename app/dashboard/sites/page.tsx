import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { PageHeader } from "@/components/ui";
import { Icons } from "@/components/icons";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { isHiddenForOrg } from "@/lib/posting-lanes";
import { POSTING_ADDON_HREF, FREE_RENTAL_POSTING_LINE } from "@/lib/billing";
import { readRobotPostingAccess } from "@/lib/robot-posting-access";
import { cleanPropertyId } from "@/lib/site-signin";
import { signinChainHref } from "@/lib/sites-setup";
import { listChannelTileStatuses } from "@/app/dashboard/properties/actions";
import { SitesRows } from "./sites-rows";
import { SubmitButton } from "@/components/submit-button";
import { emailSitesComputerLink } from "./actions";
import {
  SITES_PHONE_BUTTON,
  SITES_PHONE_LINE,
  isPhoneUserAgent,
  sitesPhoneMailedLine,
  sitesPhoneMarketplaceHref,
} from "@/lib/sites-phone";

export const dynamic = "force-dynamic";

// S760: "Connect your rental sites", the one-time setup step. Five rows, one
// state each (On, Needs you, Checking, With Posting), one progress line, one
// button that chains the three sign-in windows. The detailed per-site page
// (/dashboard/link-portals) stays for account settings and checks.
export default async function SitesSetupPage({
  searchParams,
}: {
  searchParams: { property?: string; from?: string; mailed?: string };
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

  // S768: on a phone, say the sign-ins need a computer and email the link.
  // Only for accounts that can use the sign-ins; the others see the usual rows.
  const onPhone = access.setup && isPhoneUserAgent(headers().get("user-agent"));
  let mailedLine: string | null = null;
  if (onPhone && searchParams.mailed) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    mailedLine = sitesPhoneMailedLine(searchParams.mailed, user?.email ?? null);
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
        subtitle="Sign in to each site. After that, post a rental and it goes up on every connected site. We keep the ads up and take them down when it rents. If a site signs you out, we tell you."
      />
      {!access.allowed ? (
        <p className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          {access.setup
            ? `Your Facebook Page and Marketplace are free for every account. ${FREE_RENTAL_POSTING_LINE}`
            : "Your Facebook Page and Marketplace are free for every account. Kijiji, Rentals.ca and Zumper are posted for you with Posting, $49 a month."}{" "}
          <Link href={POSTING_ADDON_HREF} className="font-semibold text-brand">
            See Posting
          </Link>
        </p>
      ) : null}
      {onPhone ? (
        <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-base text-gray-900">{SITES_PHONE_LINE}</p>
          {searchParams.mailed === "1" && mailedLine ? (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3" role="status">
              <p className="text-base font-semibold text-green-800">✓ {mailedLine}</p>
              <form action={emailSitesComputerLink} className="mt-2">
                {propertyId ? <input type="hidden" name="property_id" value={propertyId} /> : null}
                <SubmitButton pendingLabel="Sending..." className="text-sm text-green-800 underline disabled:opacity-60">
                  Send it again
                </SubmitButton>
              </form>
            </div>
          ) : (
            <form action={emailSitesComputerLink} className="mt-4">
              {propertyId ? <input type="hidden" name="property_id" value={propertyId} /> : null}
              <SubmitButton
                pendingLabel="Sending..."
                className="inline-flex w-full items-center justify-center rounded-lg bg-brand px-4 py-3 text-base font-medium text-white shadow-sm active:opacity-80 disabled:opacity-60"
              >
                {SITES_PHONE_BUTTON}
              </SubmitButton>
              {mailedLine ? (
                <p className="mt-3 text-sm text-amber-800" role="status">
                  {mailedLine}
                </p>
              ) : null}
            </form>
          )}
          <p className="mt-4 text-sm text-gray-600">
            From your phone you can still post to Facebook Marketplace.{" "}
            <Link href={sitesPhoneMarketplaceHref(propertyId)} className="font-semibold text-brand">
              Post on Marketplace
            </Link>
          </p>
        </div>
      ) : null}
      {onPhone ? (
        <details className="mt-5">
          <summary className="cursor-pointer text-sm text-gray-500">Show the sites anyway</summary>
          <div className="mt-3">
            <SitesRows
              input={{
                tileStateByChannel,
                postingAllowed: access.setup,
                propertyId,
                postingHref: POSTING_ADDON_HREF,
                facebookPageSkipped: Boolean(org.facebook_page_skipped_at),
              }}
              signinAllHref={access.setup ? signinChainHref(propertyId) : null}
            />
          </div>
        </details>
      ) : (
        <div className="mt-5">
          <SitesRows
            input={{
              tileStateByChannel,
              postingAllowed: access.setup,
              propertyId,
              postingHref: POSTING_ADDON_HREF,
              facebookPageSkipped: Boolean(org.facebook_page_skipped_at),
            }}
            signinAllHref={access.setup ? signinChainHref(propertyId) : null}
          />
        </div>
      )}
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
