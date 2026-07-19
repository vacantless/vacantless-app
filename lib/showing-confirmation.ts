export type ConfirmShowingResult = {
  ok: boolean;
  confirmed: boolean;
  reason?: "empty_token" | "not_found_or_inactive" | "update_error" | "message_error";
};

type DbClient = {
  from(table: string): any;
};

type ConfirmedShowingRow = {
  id: string;
  organization_id: string | null;
  lead_id: string | null;
};

// POST-only renter confirmation helper. It updates strictly by cancel_token and
// only for still-scheduled, not-yet-confirmed showings; repeating the same POST is
// a no-op, so scanners or double taps cannot keep changing state or duplicate notes.
export async function confirmShowingByCancelToken(
  client: DbClient,
  token: string,
  nowIso = new Date().toISOString(),
): Promise<ConfirmShowingResult> {
  const cleanToken = token.trim();
  if (!cleanToken) {
    return { ok: false, confirmed: false, reason: "empty_token" };
  }

  const { data, error } = await client
    .from("showings")
    .update({ confirmed_at: nowIso, confirmed_by: "renter" })
    .eq("cancel_token", cleanToken)
    .eq("outcome", "scheduled")
    .is("confirmed_at", null)
    .select("id, organization_id, lead_id")
    .maybeSingle();

  if (error) {
    return { ok: false, confirmed: false, reason: "update_error" };
  }
  if (!data) {
    return { ok: true, confirmed: false, reason: "not_found_or_inactive" };
  }

  const row = data as ConfirmedShowingRow;
  if (row.organization_id && row.lead_id) {
    const { error: messageError } = await client.from("messages").insert({
      organization_id: row.organization_id,
      lead_id: row.lead_id,
      channel: "note",
      direction: "inbound",
      body: "Renter confirmed their viewing",
    });
    if (messageError) {
      return { ok: true, confirmed: true, reason: "message_error" };
    }
  }

  return { ok: true, confirmed: true };
}
