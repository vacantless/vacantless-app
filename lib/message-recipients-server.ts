import type { SupabaseClient } from "@supabase/supabase-js";
import { EXTRA_RECIPIENT_MESSAGE_IDS, type ExtraRecipientMessageId } from "@/lib/message-catalog";

// S824j: the extra addresses an account added for one alert on Every message
// we send. Never throws: a failed read sends to the usual people only.

export async function loadExtraRecipients(
  admin: SupabaseClient,
  orgId: string,
  messageId: ExtraRecipientMessageId,
): Promise<string[]> {
  if (!(EXTRA_RECIPIENT_MESSAGE_IDS as readonly string[]).includes(messageId)) return [];
  try {
    const { data } = await admin
      .from("message_extra_recipients")
      .select("emails")
      .eq("organization_id", orgId)
      .eq("message_id", messageId)
      .maybeSingle();
    const list = ((data as { emails?: string[] | null } | null)?.emails ?? []).map((e) => String(e).trim().toLowerCase());
    return list.filter((e, i) => e && list.indexOf(e) === i);
  } catch {
    return [];
  }
}

/** The usual recipients plus the extras, lower-cased, without repeats. */
export function withExtras(base: string[], extras: string[]): string[] {
  const out: string[] = [];
  for (const e of [...base, ...extras]) {
    const v = String(e ?? "").trim().toLowerCase();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}
