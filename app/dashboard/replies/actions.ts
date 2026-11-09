"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrg } from "@/lib/org";
import { getCurrentRole } from "@/lib/membership";
import { roleCan } from "@/lib/roles";
import { cleanRenterName } from "@/lib/chat-leads";
import { addQuickReplyRenter } from "@/lib/chat-leads-server";

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
