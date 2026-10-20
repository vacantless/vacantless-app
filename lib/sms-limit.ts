// S726f: texting for every Growth landlord on their own number, with a monthly
// limit so one busy account cannot run up the Twilio bill. Twilio Canada
// (2026-10-20): US$0.0083 a text plus a carrier fee of about US$0.006 to
// US$0.009, and US$1.15 a month for the number. 500 texts is about US$9.
// Agile sent 11 texts in October 2026, so the limit is far above normal use.
//
// Counted from the messages timeline (channel sms, outbound) since the first
// of the month in Toronto. A text over the limit is not sent; the renter still
// gets the email.

export const SMS_MONTHLY_LIMIT = 500;

/** ISO start of the current month in America/Toronto. Pure given now. */
export function torontoMonthStartIso(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  // Toronto midnight on the 1st is 04:00 or 05:00 UTC; use 05:00 (EST), which
  // at worst counts one extra hour of the previous month's texts.
  return new Date(Date.UTC(y, m - 1, 1, 5, 0, 0)).toISOString();
}

/** True when another text would go over the limit. Pure. */
export function overMonthlyTextLimit(sentThisMonth: number, limit = SMS_MONTHLY_LIMIT): boolean {
  return Number.isFinite(sentThisMonth) && sentThisMonth >= limit;
}

type FromClient = { from: (table: string) => any };

/** Outbound texts logged for the org this month. Never throws; 0 on error. */
export async function textsSentThisMonth(
  admin: FromClient | null | undefined,
  orgId: string | null | undefined,
  now = new Date(),
): Promise<number> {
  if (!admin || !orgId) return 0;
  try {
    const { count, error } = await admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("channel", "sms")
      .eq("direction", "outbound")
      .gte("created_at", torontoMonthStartIso(now));
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}
