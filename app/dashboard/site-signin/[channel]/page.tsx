import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { adminEmails } from "@/lib/provisioning-server";
import { isAdminEmail } from "@/lib/provisioning";
import { isHiddenForOrg } from "@/lib/posting-lanes";
import {
  isSiteSigninChannel,
  cleanPropertyId,
  siteSigninEnabled,
  siteSigninIsOpen,
  siteSigninView,
  buildSigninChain,
  nextSigninChannel,
  SITE_SIGNIN_ACCOUNT_FIRST,
  SITE_SIGNIN_LABEL,
} from "@/lib/site-signin";
import { listChannelTileStatuses } from "@/app/dashboard/properties/actions";
import { startSiteSignin } from "./actions";
import { readRobotPostingAccess } from "@/lib/robot-posting-access";
import { POSTING_ADDON_HREF, POSTING_ADDON_NOTE } from "@/lib/billing";
import { WindowPanel } from "./window-panel";

export const dynamic = "force-dynamic";

const ERR: Record<string, string> = {
  config: "This is not set up yet. Please contact us.",
  save: "Something went wrong. Please try again.",
};

export default async function SiteSigninPage({
  params,
  searchParams,
}: {
  params: { channel: string };
  searchParams: { err?: string; property?: string; chain?: string };
}) {
  const channel = params.channel;
  if (!isSiteSigninChannel(channel)) notFound();
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isPlatformAdmin = isAdminEmail(user?.email ?? null, adminEmails());
  if (!siteSigninEnabled({ isPlatformAdmin }) || isHiddenForOrg(channel, org.id)) notFound();

  const { data: latest } = await supabase
    .from("site_signin_windows")
    .select("id, status, view_url, detail, created_at, expires_at")
    .eq("organization_id", org.id)
    .eq("channel", channel)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // A window from earlier today that ended stays on screen as its result;
  // anything older starts fresh.
  const recent =
    latest && Date.now() - Date.parse(latest.created_at as string) < 60 * 60 * 1000 ? latest : null;
  const name = SITE_SIGNIN_LABEL[channel];
  // S724 (V251-18): keep the rental the landlord came from (checked as theirs).
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
  const backHref = propertyId ? `/dashboard/link-portals?property=${propertyId}` : "/dashboard/link-portals";
  // S735 (item 7): one sitting. When this window finishes, the panel opens the
  // next site still to sign in to. Read the tile states now so "next" is true
  // at render time; the panel re-checks nothing, it just moves on.
  const chainOn = searchParams.chain === "1";
  let nextChannel: ReturnType<typeof nextSigninChannel> = null;
  let chainSteps: ReturnType<typeof buildSigninChain> = [];
  if (chainOn) {
    const tiles = await listChannelTileStatuses(org.id);
    const stateByChannel: Record<string, string> = {};
    for (const t of tiles) stateByChannel[t.channel] = t.state;
    chainSteps = buildSigninChain(stateByChannel, (c) => isHiddenForOrg(c, org.id));
    nextChannel = nextSigninChannel(chainSteps, channel);
  }
  const intro = siteSigninView(channel, null);
  // S705: a finished window can always be redone (sign in again, or a
  // different account). Only an open window blocks a new one.
  // S713: no Posting add-on = no sign-in form, just the add-on note.
  const access = await readRobotPostingAccess(supabase, org.id);
  const canStart =
    access.allowed && (!recent || !siteSigninIsOpen(recent.status as string));

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-6">
      <div>
        <Link href={backHref} className="text-sm text-brand">
          &larr; Your rental sites
        </Link>
        {propertyId && (
          <p className="mt-1 text-sm text-gray-500">
            For this listing:{" "}
            <Link href={`/dashboard/properties/${propertyId}?tab=market`} className="font-semibold text-gray-800 hover:underline">
              {propertyAddress ?? "your rental"}
            </Link>
          </p>
        )}
        <h1 className="mt-2 text-2xl font-bold text-gray-900">{intro.title}</h1>
        <p className="mt-2 text-sm text-gray-600">{intro.body}</p>
        {chainOn && chainSteps.length > 0 && (
          <ol className="mt-3 flex flex-wrap gap-2 text-xs">
            {chainSteps
              .filter((s) => s.state !== "off")
              .map((s) => (
                <li
                  key={s.channel}
                  className={`rounded-full border px-2.5 py-1 ${
                    s.channel === channel
                      ? "border-brand bg-brand/10 font-semibold text-gray-900"
                      : s.state === "done"
                        ? "border-green-200 bg-green-50 text-green-800"
                        : "border-gray-200 bg-white text-gray-600"
                  }`}
                >
                  {s.state === "done" && s.channel !== channel ? "✓ " : ""}
                  {s.label}
                </li>
              ))}
          </ol>
        )}
      </div>

      {searchParams.err && ERR[searchParams.err] && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {ERR[searchParams.err]}
        </p>
      )}

      {!access.allowed && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-700">
          <p className="font-semibold text-gray-900">{POSTING_ADDON_NOTE}</p>
          <p className="mt-1">We sign in and post to {name} for you with it.</p>
          <Link href={POSTING_ADDON_HREF} className="mt-3 inline-block font-semibold text-brand">
            See Billing &rarr;
          </Link>
        </div>
      )}

      {access.allowed && recent && (
        <WindowPanel
          channel={channel}
          nextChannel={nextChannel}
          propertyId={propertyId}
          initial={{
            id: recent.id as string,
            status: recent.status as string,
            viewUrl: (recent.view_url as string | null) ?? null,
            detail: (recent.detail as string | null) ?? null,
            expiresAt: (recent.expires_at as string | null) ?? null,
          }}
        />
      )}

      {canStart && (
        <form action={startSiteSignin} className="rounded-2xl border border-gray-200 bg-white p-5">
          <input type="hidden" name="channel" value={channel} />
          {propertyId && <input type="hidden" name="property" value={propertyId} />}
          {chainOn && <input type="hidden" name="chain" value="1" />}
          {recent?.status !== "done" && (
            <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {SITE_SIGNIN_ACCOUNT_FIRST[channel].text}{" "}
              <a
                href={SITE_SIGNIN_ACCOUNT_FIRST[channel].href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold underline"
              >
                {SITE_SIGNIN_ACCOUNT_FIRST[channel].linkLabel}
              </a>
            </p>
          )}
          <ul className="space-y-1.5 text-sm text-gray-700">
            <li>1. We open {name} in a secure window. It stays open for 10 minutes.</li>
            <li>2. You sign in yourself. If {name} asks you to prove you are a person, you do that too.</li>
            <li>3. We keep you signed in, locked with encryption, and close the window.</li>
          </ul>
          <p className="mt-3 text-xs text-gray-500">
            By signing in, you let us post the ads you approve on this {name} account. Your password stays with you. You can stop any time.
          </p>
          <button
            type="submit"
            className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm"
          >
            {recent?.status === "done" ? "Sign in again" : recent ? "Try again" : `Sign in to ${name}`}
          </button>
        </form>
      )}
    </div>
  );
}
