import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { adminEmails } from "@/lib/provisioning-server";
import { isAdminEmail } from "@/lib/provisioning";
import { isHiddenForOrg } from "@/lib/posting-lanes";
import {
  buildSigninChain,
  cleanPropertyId,
  nextSigninChannel,
  signinChainSummary,
  siteSigninEnabled,
  siteSigninHref,
  SITE_SIGNIN_ACCOUNT_FIRST,
} from "@/lib/site-signin";
import { listChannelTileStatuses } from "@/app/dashboard/properties/actions";
import { readRobotPostingAccess } from "@/lib/robot-posting-access";
import { POSTING_ADDON_HREF, POSTING_ADDON_NOTE } from "@/lib/billing";
import { startSiteSignin } from "./[channel]/actions";

export const dynamic = "force-dynamic";

// S735 (review item 7): sign in to Kijiji, Rentals.ca and Zumper in one
// sitting. One button starts the first window; when it finishes, the next
// site's window opens by itself. Each window is the same "Sign in once"
// window as before; this page only strings them together.
export default async function SiteSigninChainPage({
  searchParams,
}: {
  searchParams: { property?: string };
}) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isPlatformAdmin = isAdminEmail(user?.email ?? null, adminEmails());
  if (!siteSigninEnabled({ isPlatformAdmin })) redirect("/dashboard/link-portals");

  let propertyId: string | null = null;
  const wanted = cleanPropertyId(searchParams.property);
  if (wanted) {
    const { data: owned } = await supabase
      .from("properties")
      .select("id")
      .eq("id", wanted)
      .eq("organization_id", org.id)
      .maybeSingle();
    if (owned?.id) propertyId = owned.id as string;
  }

  const [tiles, access] = await Promise.all([
    listChannelTileStatuses(org.id),
    readRobotPostingAccess(supabase, org.id),
  ]);
  const stateByChannel: Record<string, string> = {};
  for (const t of tiles) stateByChannel[t.channel] = t.state;
  const chain = buildSigninChain(stateByChannel, (c) => isHiddenForOrg(c, org.id));
  const first = nextSigninChannel(chain, null);
  const shown = chain.filter((s) => s.state !== "off");
  const backHref = propertyId ? `/dashboard/link-portals?property=${propertyId}` : "/dashboard/link-portals";

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-6">
      <div>
        <Link href={backHref} className="text-sm text-brand">
          &larr; Your rental sites
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Sign in to your sites, one after the other</h1>
        <p className="mt-2 text-sm text-gray-600">{signinChainSummary(chain)}</p>
      </div>

      {!access.allowed && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-700">
          <p className="font-semibold text-gray-900">{POSTING_ADDON_NOTE}</p>
          <p className="mt-1">We sign in and post to these sites for you with it.</p>
          <Link href={POSTING_ADDON_HREF} className="mt-3 inline-block font-semibold text-brand">
            See Billing &rarr;
          </Link>
        </div>
      )}

      <ol className="space-y-2">
        {shown.map((step, i) => (
          <li
            key={step.channel}
            className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${
              step.state === "done" ? "border-green-200 bg-green-50" : "border-gray-200 bg-white"
            }`}
          >
            <span className="flex items-center gap-3">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                  step.state === "done" ? "bg-green-600 text-white" : "bg-gray-100 text-gray-700"
                }`}
              >
                {step.state === "done" ? "✓" : i + 1}
              </span>
              <span className="font-semibold text-gray-900">{step.label}</span>
            </span>
            <span className="text-xs text-gray-600">
              {step.state === "done" ? (
                "Signed in"
              ) : (
                <Link href={siteSigninHref(step.channel, propertyId)} className="text-brand underline">
                  Just this one
                </Link>
              )}
            </span>
          </li>
        ))}
      </ol>

      {access.allowed && first && (
        <form action={startSiteSignin} className="rounded-2xl border border-gray-200 bg-white p-5">
          <input type="hidden" name="channel" value={first} />
          <input type="hidden" name="chain" value="1" />
          {propertyId && <input type="hidden" name="property" value={propertyId} />}
          <ul className="space-y-1.5 text-sm text-gray-700">
            <li>1. We open each site in a secure window, one at a time. Each stays open for 10 minutes.</li>
            <li>2. You sign in yourself on each site. Your password stays with you.</li>
            <li>3. When one is done, the next opens by itself. You can stop after any site.</li>
          </ul>
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            You need an account on each site first.{" "}
            {shown
              .filter((s) => s.state === "todo")
              .map((s) => (
                <a
                  key={s.channel}
                  href={SITE_SIGNIN_ACCOUNT_FIRST[s.channel].href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mr-2 font-semibold underline"
                >
                  {SITE_SIGNIN_ACCOUNT_FIRST[s.channel].linkLabel}
                </a>
              ))}
            Zumper checks your ID before it lets you post.
          </p>
          <button type="submit" className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm">
            Sign in to {chain.find((s) => s.channel === first)?.label} first
          </button>
        </form>
      )}
    </div>
  );
}
