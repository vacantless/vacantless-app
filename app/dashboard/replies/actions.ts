"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrg } from "@/lib/org";
import { getCurrentRole } from "@/lib/membership";
import { roleCan } from "@/lib/roles";
import { cleanRenterName } from "@/lib/chat-leads";
import { addQuickReplyRenter } from "@/lib/chat-leads-server";
import { createClient } from "@/lib/supabase/server";
import { hashSendKey, makeSendKey, sendKeyHint } from "@/lib/send-shortcut";

// S767 (PLAN-S766 item A): "Add this renter" on Quick replies. The phone has
// no helper, so the landlord adds the chat renter by name. Same rules as the
// helper's save (lib/chat-leads-server): one renter per name per rental.

export async function addChatRenter(input: {
  propertyId: string;
  siteKey: string;
  name: string;
}): Promise<{ ok: boolean; message: string }> {
  const name = cleanRenterName(input.name);
  if (!name) return { ok: false, message: "Type the renter's name first." };
  const org = await getCurrentOrg();
  const role = await getCurrentRole();
  const admin = createAdminClient();
  if (!org || !admin || !roleCan(role, "manage_leads")) {
    return { ok: false, message: "Your sign-in can't add renters in this account." };
  }
  const r = await addQuickReplyRenter(admin, {
    orgId: org.id,
    propertyId: String(input.propertyId || ""),
    name,
    siteKey: String(input.siteKey || "") || null,
  });
  if (r === "saved") {
    revalidatePath("/dashboard/leads");
    return { ok: true, message: `${name} is in Renters as Replied.` };
  }
  if (r === "exists") return { ok: true, message: `${name} is already in Renters for this rental.` };
  if (r === "not_available") return { ok: false, message: "This rental is not available, so no renter was added." };
  return { ok: false, message: "We could not add the renter. Try again." };
}

// S816l: "Send to Vacantless" key for the iPhone share menu. Making a new key
// turns off this person's old key in this account. The key is shown once.
export async function makeSendToVacantlessKey(): Promise<{ ok: boolean; key?: string; message?: string }> {
  const org = await getCurrentOrg();
  const role = await getCurrentRole();
  const admin = createAdminClient();
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!org || !admin || !user || !roleCan(role, "manage_leads")) {
    return { ok: false, message: "Your sign-in can't add renters in this account." };
  }
  const now = new Date().toISOString();
  await admin
    .from("capture_keys")
    .update({ revoked_at: now })
    .eq("user_id", user.id)
    .eq("organization_id", org.id)
    .is("revoked_at", null);
  const key = makeSendKey();
  const { error } = await admin.from("capture_keys").insert({
    organization_id: org.id,
    user_id: user.id,
    key_hash: hashSendKey(key),
    key_hint: sendKeyHint(key),
  });
  if (error) return { ok: false, message: "We could not make a key. Try again." };
  revalidatePath("/dashboard/replies");
  return { ok: true, key };
}

export async function turnOffSendToVacantlessKey(): Promise<{ ok: boolean }> {
  const org = await getCurrentOrg();
  const admin = createAdminClient();
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!org || !admin || !user) return { ok: false };
  await admin
    .from("capture_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("organization_id", org.id)
    .is("revoked_at", null);
  revalidatePath("/dashboard/replies");
  return { ok: true };
}
