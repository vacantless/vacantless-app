import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhoneE164 } from "@/lib/sms";
import { normalizeEmail } from "@/lib/persons";
import { roleCan } from "@/lib/roles";
import { addAskedAgainNote, saveChatRenter } from "@/lib/chat-leads-server";
import { cleanRenterName, CHAT_LEAD_MATCH_DAYS } from "@/lib/chat-leads";
import { openRentalsForOrg, readScreenshotWithAi } from "@/lib/ai-enquiry-server";
import { hashSendKey, nextWindow, othersForRented, planSend, rentedChatReply, rentedForReader, sendResultLine, sendSource, soldAdRental } from "@/lib/send-shortcut";
import type { EnquiryRental } from "@/lib/ai-enquiry";

/** S830e: the account's rented rentals (not archived), for the reader's list. */
async function rentedRentalsForOrg(admin: SupabaseClient, orgId: string): Promise<EnquiryRental[]> {
  const { data } = await admin
    .from("properties")
    .select("id, address, rent_cents, beds")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .in("status", ["leased", "rented"])
    .limit(60);
  return ((data ?? []) as Array<{ id: string; address: string | null; rent_cents: number | null; beds: number | null }>).map((p) => ({
    id: p.id,
    address: p.address ?? "",
    rentDollars: typeof p.rent_cents === "number" ? Math.round(p.rent_cents / 100) : null,
    beds: p.beds,
  }));
}

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com").replace(/\/+$/, "");

/** S845c: an account's rented rentals whose Marketplace ad came down in the last 30 days. */
async function soldAdCandidates(admin: SupabaseClient, orgId: string, rented: EnquiryRental[]): Promise<EnquiryRental[]> {
  if (rented.length === 0) return [];
  const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const { data } = await admin
    .from("listing_posts")
    .select("property_id")
    .eq("organization_id", orgId)
    .eq("portal", "facebook")
    .eq("status", "removed")
    .gte("down_at", since)
    .in("property_id", rented.map((r) => r.id));
  const ids = new Set(((data ?? []) as { property_id: string | null }[]).map((r) => r.property_id));
  return rented.filter((r) => ids.has(r.id));
}

// S816l: the server half of "Send to Vacantless". Everything here runs with
// the service-role client, scoped to the key's own account.

export type SendKeyOwner = { keyId: string; orgId: string; userId: string };

/** The key's account, if the key is live and its person may still add renters. */
export async function checkSendKey(
  admin: SupabaseClient,
  rawKey: string,
  now: Date = new Date(),
): Promise<{ ok: true; owner: SendKeyOwner } | { ok: false; reason: "key" | "role" | "limit" }> {
  const { data } = await admin
    .from("capture_keys")
    .select("id, organization_id, user_id, revoked_at, window_start, uses_in_window")
    .eq("key_hash", hashSendKey(rawKey))
    .maybeSingle();
  const row = data as {
    id: string;
    organization_id: string;
    user_id: string;
    revoked_at: string | null;
    window_start: string | null;
    uses_in_window: number | null;
  } | null;
  if (!row || row.revoked_at) return { ok: false, reason: "key" };
  const { data: m } = await admin
    .from("memberships")
    .select("role")
    .eq("user_id", row.user_id)
    .eq("organization_id", row.organization_id)
    .limit(1);
  const role = (m as { role: string | null }[] | null)?.[0]?.role ?? null;
  if (!role || !roleCan(role, "manage_leads")) return { ok: false, reason: "role" };
  const w = nextWindow(row.window_start, row.uses_in_window ?? 0, now);
  if (!w.allowed) return { ok: false, reason: "limit" };
  await admin
    .from("capture_keys")
    .update({ last_used_at: now.toISOString(), window_start: w.windowStart, uses_in_window: w.uses })
    .eq("id", row.id);
  return { ok: true, owner: { keyId: row.id, orgId: row.organization_id, userId: row.user_id } };
}

/** S829h: the key's own account first, then the others this person can add renters in. */
export async function sendOrgIds(admin: SupabaseClient, owner: SendKeyOwner): Promise<string[]> {
  const { data } = await admin.from("memberships").select("organization_id, role").eq("user_id", owner.userId);
  const others = ((data ?? []) as { organization_id: string | null; role: string | null }[])
    .filter((m) => m.organization_id && m.organization_id !== owner.orgId && roleCan(m.role, "manage_leads"))
    .map((m) => m.organization_id as string);
  return [owner.orgId, ...Array.from(new Set(others))];
}

/** S817b: what was saved, plus what the reply needs (rental, question, site, name). */
export type SendSaved = {
  line: string;
  leadId: string | null;
  /** S830a: what the screenshot reader says the renter asked about. */
  topic?: string | null;
  /** S829h: the account the renter was saved in (the rental's own). */
  orgId?: string;
  rentalId?: string | null;
  question?: string | null;
  site?: string | null;
  name?: string | null;
  /** S845c: the chat is about a rented rental; this is the reply to copy. */
  rentedReply?: string | null;
};

/** Read the screenshot and save the renter. Returns the line the Shortcut shows. */
export async function saveRenterFromShortcut(
  admin: SupabaseClient,
  owner: SendKeyOwner,
  image: { mediaType: string; base64: string },
  opts: { via?: string } = {},
): Promise<SendSaved> {
  // S829h: one person's Facebook posts for every account they manage (Noam:
  // Agile and Davis). The key was made in one account, so the chat's rental
  // was never found when it belonged to the other. Look in all of them and
  // save the renter in the account that owns the rental.
  const orgIds = await sendOrgIds(admin, owner);
  const rentalOrg = new Map<string, string>();
  const rentals = (
    await Promise.all(
      orgIds.map(async (id) => {
        const list = await openRentalsForOrg(admin, id);
        for (const r of list) rentalOrg.set(r.id, id);
        return list;
      }),
    )
  ).flat();
  // S830e: rented units too (never one that shares a rent with an open one),
  // so a chat about a rented unit says so instead of saving a stray renter.
  const rentedByOrg = await Promise.all(orgIds.map((id) => rentedRentalsForOrg(admin, id).catch(() => [] as EnquiryRental[])));
  rentedByOrg.forEach((list, i) => list.forEach((r) => rentalOrg.set(r.id, orgIds[i])));
  const allRented = rentedByOrg.flat();
  const rented = rentedForReader(rentals, allRented);
  const rentedIds = new Set(rented.map((r) => r.id));
  const read = await readScreenshotWithAi(image, [...rentals, ...rented]);
  if (!read) return { line: sendResultLine({ outcome: "unreadable" }), leadId: null };
  // Which fields came back (never the values), so a miss can be traced.
  console.log(
    `[shortcut/renter] read org=${owner.orgId} name=${Boolean(read.name)} email=${Boolean(read.email)} phone=${Boolean(read.phone)} rental=${Boolean(read.rentalId)} site=${read.site ?? "none"} topic=${read.topic ?? "none"} not_renter=${Boolean(read.notRenter)}`,
  );

  // S845c (Noam's choice, 2026-11-26): a chat about a rented rental still saves
  // the renter, on that rental, and copies a reply that says it is rented and
  // names what is open. A SOLD listing line with no price is matched to the one
  // rented rental whose Marketplace ad came down lately.
  let rentedHit: EnquiryRental | null =
    read.rentalId && rentedIds.has(read.rentalId) ? allRented.find((x) => x.id === read.rentalId) ?? null : null;
  if (!rentedHit && read.adSold) {
    const down = (await Promise.all(orgIds.map((id, i) => soldAdCandidates(admin, id, rentedByOrg[i]).catch(() => [] as EnquiryRental[])))).flat();
    rentedHit = soldAdRental(true, down);
    // A SOLD line carries no price, so a pick of an open rental is a guess.
    if (!rentedHit) read.rentalId = null;
  }

  const name = cleanRenterName(read.name);
  const email = normalizeEmail(read.email ?? "") || null;
  const phone = (read.phone ?? "").trim().slice(0, 40) || null;
  const rental = rentedHit ?? (read.rentalId ? rentals.find((r) => r.id === read.rentalId) ?? null : null);
  const rentalLabel = rental?.address ?? null;
  const orgId = (rental && rentalOrg.get(rental.id)) || owner.orgId;
  const question = (read.question ?? "").trim().slice(0, 400);
  const source = sendSource(read.site);
  const note = [question ? `Asked: ${question}` : null, opts.via ?? "Sent from the iPhone share menu (chat screenshot)."]
    .filter(Boolean)
    .join("\n");

  const rentedReply = rentedHit
    ? rentedChatReply({
        rentalName: rentedHit.address,
        renterName: name,
        others: othersForRented(
          rentedHit.beds,
          rentals.filter((r) => rentalOrg.get(r.id) === orgId),
        ).map((r) => ({ address: r.address, rentDollars: r.rentDollars, url: `${APP_URL}/r/${r.id}` })),
      })
    : null;
  const ctx = { orgId, rentalId: rental?.id ?? null, question: question || null, topic: read.topic ?? null, site: read.site ?? null, name, rentedReply };
  const plan = planSend({ name, email, phone, rentalId: rental?.id ?? null, notRenter: read.notRenter });
  // S830b: nothing saved and nothing copied for an agent, seller or spam.
  if (plan.kind === "not_renter") return { line: sendResultLine({ outcome: "not_renter" }), leadId: null };
  if (plan.kind === "no_renter") return { line: sendResultLine({ outcome: "no_renter" }), leadId: null, ...ctx };

  if (plan.kind === "chat_name") {
    const r = await saveChatRenter(admin, {
      orgId,
      propertyId: plan.propertyId,
      name: name!,
      source,
      sourceDetail: null,
      listingPostId: null,
      note,
      question: question || null,
    });
    return {
      line: sendResultLine({
        outcome: r,
        name,
        rental: rentalLabel,
        questionAdded: r === "exists" && !!question,
        // S830f: a one-word name may be a different person with that first name.
        firstNameOnly: r === "exists" && !!name && !/\s/.test(name.trim()),
      }),
      leadId: null,
      ...ctx,
    };
  }

  if (plan.kind === "contact") {
    const since = new Date(Date.now() - CHAT_LEAD_MATCH_DAYS * 24 * 60 * 60_000).toISOString();
    const e164 = normalizePhoneE164(phone);
    const ors = [email ? `email.eq."${email}"` : null, e164 ? `phone_e164.eq."${e164}"` : null].filter(Boolean).join(",");
    if (ors) {
      const { data: dupes } = await admin
        .from("leads")
        .select("id")
        .eq("organization_id", orgId)
        .gte("created_at", since)
        .or(ors)
        .limit(1);
      const hit = (dupes as { id: string }[] | null)?.[0];
      if (hit) {
        // S824a: the renter is already saved; keep the new question on their page.
        const added = question ? await addAskedAgainNote(admin, orgId, hit.id, question) : false;
        return {
          line: sendResultLine({ outcome: "exists", name, rental: rentalLabel, questionAdded: added }),
          leadId: hit.id,
          ...ctx,
        };
      }
    }
  }

  const { data, error } = await admin
    .from("leads")
    .insert({
      organization_id: orgId,
      property_id: rental?.id ?? null,
      name,
      email,
      phone,
      // S829h: phone_e164 is a generated column; writing it failed every save
      // that reached this insert (Noam's Koby screenshot, 2026-11-22).
      source,
      status: email || phone ? "new" : "replied",
      notes: note,
    })
    .select("id")
    .maybeSingle();
  if (error || !data?.id) {
    console.error(`[shortcut/renter] save failed: ${error?.code ?? "no_row"} ${error?.message ?? ""}`);
    return { line: sendResultLine({ outcome: "failed" }), leadId: null };
  }
  return { line: sendResultLine({ outcome: "saved", name, rental: rentalLabel }), leadId: (data as { id: string }).id, ...ctx };
}
