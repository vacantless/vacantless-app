import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { adminEmails } from "@/lib/provisioning-server";
import { isAdminEmail } from "@/lib/provisioning";
import { isHiddenForOrg } from "@/lib/posting-lanes";
import {
  isSiteSigninChannel,
  siteSigninEnabled,
  siteSigninIsOpen,
  siteSigninView,
  SITE_SIGNIN_LABEL,
} from "@/lib/site-signin";
import { startSiteSignin } from "./actions";
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
  searchParams: { err?: string };
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
    .select("id, status, view_url, detail, created_at")
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
  const intro = siteSigninView(channel, null);
  // S705: a finished window can always be redone (sign in again, or a
  // different account). Only an open window blocks a new one.
  const canStart = !recent || !siteSigninIsOpen(recent.status as string);

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-6">
      <div>
        <Link href="/dashboard/link-portals" className="text-sm text-brand">
          &larr; Your rental sites
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">{intro.title}</h1>
        <p className="mt-2 text-sm text-gray-600">{intro.body}</p>
      </div>

      {searchParams.err && ERR[searchParams.err] && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {ERR[searchParams.err]}
        </p>
      )}

      {recent && (
        <WindowPanel
          channel={channel}
          initial={{
            id: recent.id as string,
            status: recent.status as string,
            viewUrl: (recent.view_url as string | null) ?? null,
            detail: (recent.detail as string | null) ?? null,
          }}
        />
      )}

      {canStart && (
        <form action={startSiteSignin} className="rounded-2xl border border-gray-200 bg-white p-5">
          <input type="hidden" name="channel" value={channel} />
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
