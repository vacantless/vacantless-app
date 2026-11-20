import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhoneE164 } from "@/lib/sms";
import { normalizeEmail } from "@/lib/persons";
import { roleCan } from "@/lib/roles";
import { addAskedAgainNote, saveChatRenter } from "@/lib/chat-leads-server";
import { cleanRenterName, CHAT_LEAD_MATCH_DAYS } from "@/lib/chat-leads";
import { openRentalsForOrg, readScreenshotWithAi } from "@/lib/ai-enquiry-server";
import { hashSendKey, nextWindow, planSend, sendResultLine, sendSource } from "@/lib/send-shortcut";

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

/** S817b: what was saved, plus what the reply needs (rental, question, site, name). */
export type SendSaved = {
  line: string;
  leadId: string | null;
  rentalId?: string | null;
  question?: string | null;
  site?: string | null;
  name?: string | null;
};

/** Read the screenshot and save the renter. Returns the line the Shortcut shows. */
export async function saveRenterFromShortcut(
  admin: SupabaseClient,
  owner: SendKeyOwner,
  image: { mediaType: string; base64: string },
  opts: { via?: string } = {},
): Promise<SendSaved> {
  const rentals = await openRentalsForOrg(admin, owner.orgId);
  const read = await readScreenshotWithAi(image, rentals);
  if (!read) return { line: sendResultLine({ outcome: "unreadable" }), leadId: null };
  // Which fields came back (never the values), so a miss can be traced.
  console.log(
    `[shortcut/renter] read org=${owner.orgId} name=${Boolean(read.name)} email=${Boolean(read.email)} phone=${Boolean(read.phone)} rental=${Boolean(read.rentalId)} site=${read.site ?? "none"}`,
  );

  const name = cleanRenterName(read.name);
  const email = normalizeEmail(read.email ?? "") || null;
  const phone = (read.phone ?? "").trim().slice(0, 40) || null;
  const rental = read.rentalId ? rentals.find((r) => r.id === read.rentalId) ?? null : null;
  const rentalLabel = rental?.address ?? null;
  const question = (read.question ?? "").trim().slice(0, 400);
  const source = sendSource(read.site);
  const note = [question ? `Asked: ${question}` : null, opts.via ?? "Sent from the iPhone share menu (chat screenshot)."]
    .filter(Boolean)
    .join("\n");

  const ctx = { rentalId: rental?.id ?? null, question: question || null, site: read.site ?? null, name };
  const plan = planSend({ name, email, phone, rentalId: rental?.id ?? null });
  if (plan.kind === "no_renter") return { line: sendResultLine({ outcome: "no_renter" }), leadId: null, ...ctx };

  if (plan.kind === "chat_name") {
    const r = await saveChatRenter(admin, {
      orgId: owner.orgId,
      propertyId: plan.propertyId,
      name: name!,
      source,
      sourceDetail: null,
      listingPostId: null,
      note,
      question: question || null,
    });
    return {
      line: sendResultLine({ outcome: r, name, rental: rentalLabel, questionAdded: r === "exists" && !!question }),
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
        .eq("organization_id", owner.orgId)
        .gte("created_at", since)
        .or(ors)
        .limit(1);
      const hit = (dupes as { id: string }[] | null)?.[0];
      if (hit) {
        // S824a: the renter is already saved; keep the new question on their page.
        const added = question ? await addAskedAgainNote(admin, owner.orgId, hit.id, question) : false;
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
      organization_id: owner.orgId,
      property_id: rental?.id ?? null,
      name,
      email,
      phone,
      phone_e164: normalizePhoneE164(phone),
      source,
      status: email || phone ? "new" : "replied",
      notes: note,
    })
    .select("id")
    .maybeSingle();
  if (error || !data?.id) return { line: sendResultLine({ outcome: "failed" }), leadId: null };
  return { line: sendResultLine({ outcome: "saved", name, rental: rentalLabel }), leadId: (data as { id: string }).id, ...ctx };
}
