import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString } from "@/lib/leasing-snapshot";
import {
  CHAT_LEAD_MATCH_DAYS,
  CHAT_LEAD_NOTE_HELPER,
  chatLeadNoteManual,
  chatLeadSource,
  cleanRenterName,
  findChatPlaceholderToMerge,
  findExistingChatLead,
  mergedChatNote,
  type ChatLeadCandidate,
  type HelperRepliedChat,
} from "@/lib/chat-leads";
import { portalLabel } from "@/lib/listing-distribution";

// S767 (PLAN-S766 item A): the server half of chat renters. Callers check
// the signed-in person's accounts first (helperOrgIds or getCurrentOrg); every
// read and write here is scoped to those account ids.

type LeadRow = {
  id: string;
  property_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  notes: string | null;
  created_at: string;
};

function toCandidate(r: LeadRow): ChatLeadCandidate {
  return {
    id: r.id,
    propertyId: r.property_id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    status: r.status,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

async function recentLeads(admin: SupabaseClient, orgId: string, propertyId: string): Promise<ChatLeadCandidate[] | null> {
  const since = new Date(Date.now() - CHAT_LEAD_MATCH_DAYS * 24 * 60 * 60_000).toISOString();
  const { data, error } = await admin
    .from("leads")
    .select("id, property_id, name, email, phone, status, notes, created_at")
    .eq("organization_id", orgId)
    .eq("property_id", propertyId)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(300);
  if (error) return null;
  return ((data ?? []) as LeadRow[]).map(toCandidate);
}

/**
 * Save one chat renter on an available rental unless the same renter already
 * has an open lead there. Returns "saved", "exists", "not_available" or "failed".
 */
export async function saveChatRenter(
  admin: SupabaseClient,
  input: {
    orgId: string;
    propertyId: string;
    name: string;
    source: string;
    sourceDetail: string | null;
    listingPostId: string | null;
    note: string;
  },
): Promise<"saved" | "exists" | "not_available" | "failed"> {
  const name = cleanRenterName(input.name);
  if (!name) return "failed";
  const { data: prop } = await admin
    .from("properties")
    .select("id, status, archived_at")
    .eq("id", input.propertyId)
    .eq("organization_id", input.orgId)
    .maybeSingle();
  const p = prop as { status: string | null; archived_at: string | null } | null;
  if (!p || p.archived_at || p.status !== "available") return "not_available";
  const leads = await recentLeads(admin, input.orgId, input.propertyId);
  if (!leads) return "failed";
  if (findExistingChatLead(leads, { propertyId: input.propertyId, name })) return "exists";
  const { error } = await admin.from("leads").insert({
    organization_id: input.orgId,
    property_id: input.propertyId,
    name,
    source: input.source,
    source_detail: input.sourceDetail,
    listing_post_id: input.listingPostId,
    status: "replied",
    notes: input.note,
  });
  return error ? "failed" : "saved";
}

/**
 * Helper 1.2.5: the renters the landlord pressed "Fill booking reply" for.
 * Returns every entry the helper may forget (saved, already a renter, or not
 * an ad Vacantless follows). The key is itemId|renterName.
 */
export async function saveHelperRepliedChats(
  admin: SupabaseClient,
  orgIds: string[],
  items: HelperRepliedChat[],
): Promise<string[]> {
  const done: string[] = [];
  if (orgIds.length === 0) return done;
  for (const item of items) {
    const key = `${item.itemId}|${item.renterName}`;
    const { data: rows, error } = await admin
      .from("listing_posts")
      .select("id, organization_id, property_id, url")
      .in("organization_id", orgIds)
      .eq("portal", "facebook")
      .eq("status", "live")
      .ilike("url", `%/marketplace/item/${item.itemId}%`)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) continue; // kept by the helper, tried again on the next page
    const post = ((rows ?? []) as { id: string; organization_id: string; property_id: string | null; url: string | null }[])[0];
    if (!post || !post.property_id) {
      done.push(key);
      continue;
    }
    const r = await saveChatRenter(admin, {
      orgId: post.organization_id,
      propertyId: post.property_id,
      name: item.renterName,
      source: "Facebook Marketplace",
      sourceDetail: post.url,
      listingPostId: post.id,
      note: CHAT_LEAD_NOTE_HELPER,
    });
    if (r !== "failed") done.push(key);
  }
  return done;
}

/** Quick replies: "Add this renter" for one rental and the site the chat is on. */
export async function addQuickReplyRenter(
  admin: SupabaseClient,
  input: { orgId: string; propertyId: string; name: string; siteKey: string | null },
): Promise<"saved" | "exists" | "not_available" | "failed"> {
  let post: { id: string; url: string | null } | null = null;
  if (input.siteKey && input.siteKey !== "direct") {
    const { data } = await admin
      .from("listing_posts")
      .select("id, url")
      .eq("organization_id", input.orgId)
      .eq("property_id", input.propertyId)
      .eq("portal", input.siteKey)
      .eq("status", "live")
      .order("created_at", { ascending: false })
      .limit(1);
    post = ((data ?? []) as { id: string; url: string | null }[])[0] ?? null;
  }
  const label = input.siteKey && input.siteKey !== "direct" ? portalLabel(input.siteKey) : "text or other";
  return saveChatRenter(admin, {
    orgId: input.orgId,
    propertyId: input.propertyId,
    name: input.name,
    source: chatLeadSource(post ? input.siteKey : null),
    sourceDetail: post?.url ?? null,
    listingPostId: post?.id ?? null,
    note: chatLeadNoteManual(label),
  });
}

/**
 * A renter booked or wrote through the rental page. When exactly one chat
 * renter with the same name waits on that rental, the new lead takes its
 * place: an activity note dated the chat day goes on the new lead and the
 * placeholder is removed. Skipped when the placeholder has anything attached. Best effort:
 * never blocks the renter.
 */
export async function mergeChatPlaceholderInto(
  admin: SupabaseClient,
  input: { newLeadId: string; propertyId: string; name: string | null },
): Promise<boolean> {
  try {
    const name = cleanRenterName(input.name);
    if (!name) return false;
    const { data: lead } = await admin
      .from("leads")
      .select("id, organization_id")
      .eq("id", input.newLeadId)
      .maybeSingle();
    const nl = lead as { id: string; organization_id: string } | null;
    if (!nl) return false;
    const leads = await recentLeads(admin, nl.organization_id, input.propertyId);
    if (!leads) return false;
    const ph = findChatPlaceholderToMerge(leads, { propertyId: input.propertyId, name, newLeadId: nl.id });
    if (!ph) return false;
    for (const table of ["showings", "messages", "rental_applications"]) {
      const { count, error } = await admin.from(table).select("id", { count: "exact", head: true }).eq("lead_id", ph.id);
      if (error || (count ?? 0) > 0) return false;
    }
    const { data: org } = await admin.from("organizations").select("booking_timezone").eq("id", nl.organization_id).maybeSingle();
    const tz = (org as { booking_timezone?: string | null } | null)?.booking_timezone || "America/Toronto";
    const line = mergedChatNote(ph.notes, localDateString(new Date(ph.createdAt).getTime(), tz));
    // An activity note dated when the chat happened; the renter's own message
    // (leads.notes) is left as they wrote it.
    const { error: noteErr } = await admin.from("messages").insert({
      organization_id: nl.organization_id,
      lead_id: nl.id,
      channel: "note",
      direction: "outbound",
      body: line,
      created_at: new Date(ph.createdAt).toISOString(),
    });
    if (noteErr) return false;
    const { error: delErr } = await admin
      .from("leads")
      .delete()
      .eq("id", ph.id)
      .eq("organization_id", nl.organization_id)
      .is("email", null)
      .is("phone", null);
    return !delErr;
  } catch {
    return false;
  }
}
