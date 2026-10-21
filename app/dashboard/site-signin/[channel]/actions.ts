"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { adminEmails } from "@/lib/provisioning-server";
import { isAdminEmail } from "@/lib/provisioning";
import { isHiddenForOrg } from "@/lib/posting-lanes";
import {
  isSiteSigninChannel,
  siteSigninEnabled,
  siteSigninHref,
  cleanPropertyId,
  withQuery,
  siteSigninIsOpen,
} from "@/lib/site-signin";
import { triggerSigninWindow } from "@/lib/site-signin-dispatch";
import { triggerPostNow } from "@/lib/post-now";
import { readRobotPostingAccess } from "@/lib/robot-posting-access";

const FORBIDDEN = "/dashboard/properties?forbidden=1";
const TABLE = "site_signin_windows";

async function currentUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

async function allowed(): Promise<{ orgId: string; userId: string | null } | null> {
  await requireCapability("manage_properties", FORBIDDEN);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const user = await currentUser();
  const isPlatformAdmin = isAdminEmail(user?.email ?? null, adminEmails());
  if (!siteSigninEnabled({ isPlatformAdmin })) return null;
  return { orgId: org.id, userId: user?.id ?? null };
}

/** Start a window (or reuse the one already open for this site). */
export async function startSiteSignin(formData: FormData): Promise<void> {
  const channel = String(formData.get("channel") ?? "");
  const propertyId = cleanPropertyId(formData.get("property"));
  if (!isSiteSigninChannel(channel)) redirect("/dashboard/link-portals");
  const who = await allowed();
  if (!who) redirect("/dashboard/link-portals");
  if (isHiddenForOrg(channel, who.orgId)) redirect("/dashboard/link-portals");
  // S713: signing in is for robot posting, which is the paid Posting add-on.
  // No window (and no worker run) without it.
  const access = await readRobotPostingAccess(createClient(), who.orgId);
  if (!access.allowed) redirect(withQuery(siteSigninHref(channel, propertyId), "err", "addon"));

  const admin = createAdminClient();
  if (!admin) redirect(withQuery(siteSigninHref(channel, propertyId), "err", "config"));

  const { data: open } = await admin
    .from(TABLE)
    .select("id, status, expires_at")
    .eq("organization_id", who.orgId)
    .eq("channel", channel)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (open && siteSigninIsOpen(open.status as string) && Date.parse(open.expires_at as string) > Date.now()) {
    redirect(siteSigninHref(channel, propertyId));
  }

  const { data: created, error } = await admin
    .from(TABLE)
    .insert({ organization_id: who.orgId, channel, requested_by: who.userId, status: "starting" })
    .select("id")
    .single();
  if (error || !created) redirect(withQuery(siteSigninHref(channel, propertyId), "err", "save"));

  const dispatched = await triggerSigninWindow(created.id as string, channel);
  if (!dispatched) {
    await admin
      .from(TABLE)
      .update({ status: "failed", detail: "dispatch", updated_at: new Date().toISOString() })
      .eq("id", created.id);
  }
  redirect(siteSigninHref(channel, propertyId));
}

export type SiteSigninWindowRead = {
  id: string;
  status: string;
  viewUrl: string | null;
  detail: string | null;
  /** S714: set by the worker when the window turns ready (ready + 10 minutes). */
  expiresAt?: string | null;
} | null;

/** Poll target for the window panel. RLS scopes the read to the org. */
export async function readSiteSigninWindow(id: string): Promise<SiteSigninWindowRead> {
  const supabase = createClient();
  const { data } = await supabase
    .from(TABLE)
    .select("id, status, view_url, detail, expires_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  // S718: a fresh sign-in releases posts that were waiting on it. Start the
  // posting robot now instead of at its next scheduled check. Only for a
  // window that finished in the last two minutes, so an old page does not
  // keep starting it. Never blocks the read.
  if (data.status === "done") {
    const at = Date.parse(String(data.updated_at ?? ""));
    if (!Number.isNaN(at) && Date.now() - at < 120_000) void triggerPostNow();
  }
  return {
    id: data.id as string,
    status: data.status as string,
    viewUrl: (data.view_url as string | null) ?? null,
    detail: (data.detail as string | null) ?? null,
    expiresAt: (data.expires_at as string | null) ?? null,
  };
}

async function updateOwnWindow(id: string, patch: Record<string, unknown>): Promise<void> {
  const who = await allowed();
  if (!who) return;
  const admin = createAdminClient();
  if (!admin) return;
  await admin
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", who.orgId)
    .in("status", ["starting", "ready"]);
}

/** "I'm signed in": the worker checks right away instead of waiting. */
export async function confirmSiteSignin(id: string): Promise<void> {
  await updateOwnWindow(id, { confirm_requested_at: new Date().toISOString(), detail: null });
}

export async function cancelSiteSignin(id: string): Promise<void> {
  await updateOwnWindow(id, { status: "cancelled", view_url: null });
}

/**
 * S728: a window that is still "starting" after three minutes never opened
 * (the runner is asleep or the dispatch was lost). Mark it failed so the
 * page offers Try again instead of a spinner that never ends.
 */
export async function failStalledSiteSignin(id: string): Promise<void> {
  const who = await allowed();
  if (!who) return;
  const admin = createAdminClient();
  if (!admin) return;
  await admin
    .from(TABLE)
    .update({ status: "failed", detail: "did_not_open", view_url: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", who.orgId)
    .eq("status", "starting")
    .lt("created_at", new Date(Date.now() - 3 * 60_000).toISOString());
}
