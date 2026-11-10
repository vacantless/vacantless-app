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

/** Count rows for the org since the start of the month. Never throws; 0 on error. */
async function countSince(admin: FromClient, table: string, column: string, orgId: string, since: string, extra?: (q: any) => any): Promise<number> {
  try {
    let q = admin.from(table).select("id", { count: "exact", head: true }).eq("organization_id", orgId).gte(column, since);
    if (extra) q = extra(q);
    const { count, error } = await q;
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Texts sent for the org this month. S777 (KI1549): sms_sends holds every text
 * sendSms sent from the org's own number, including landlord alerts that never
 * reach messages. The count is the larger of the two, so the month the table
 * started (or a read that fails) still counts the renter texts in messages.
 * Never throws; 0 when nothing can be read.
 */
export async function textsSentThisMonth(
  admin: FromClient | null | undefined,
  orgId: string | null | undefined,
  now = new Date(),
): Promise<number> {
  if (!admin || !orgId) return 0;
  const since = torontoMonthStartIso(now);
  const [logged, sends] = await Promise.all([
    countSince(admin, "messages", "created_at", orgId, since, (q) => q.eq("channel", "sms").eq("direction", "outbound")),
    countSince(admin, "sms_sends", "sent_at", orgId, since),
  ]);
  return monthlyTextCount(logged, sends);
}

/** The larger of the two counts; a bad number counts as 0. Pure. */
export function monthlyTextCount(messagesCount: number, smsSendsCount: number): number {
  const a = Number.isFinite(messagesCount) ? messagesCount : 0;
  const b = Number.isFinite(smsSendsCount) ? smsSendsCount : 0;
  return Math.max(a, b);
}

/** S777: record one text sent from the org's own number. Never throws. */
export async function logTextSent(admin: FromClient | null | undefined, orgId: string | null | undefined): Promise<void> {
  if (!admin || !orgId) return;
  try {
    await admin.from("sms_sends").insert({ organization_id: orgId });
  } catch {
    // Counting must never block or fail a text.
  }
}

/**
 * S779: the account's monthly text limit from its plan (door bands: Starter
 * 200, Growth 500, Portfolio 1,000; every other plan 500). Never throws;
 * SMS_MONTHLY_LIMIT when the plan cannot be read.
 */
export async function textLimitForOrg(
  admin: FromClient | null | undefined,
  orgId: string | null | undefined,
): Promise<number> {
  if (!admin || !orgId) return SMS_MONTHLY_LIMIT;
  try {
    const { textCapForPlan } = await import("./billing");
    const { data, error } = await admin.from("organizations").select("plan").eq("id", orgId).maybeSingle();
    if (error) return SMS_MONTHLY_LIMIT;
    return textCapForPlan((data as { plan?: string | null } | null)?.plan ?? null);
  } catch {
    return SMS_MONTHLY_LIMIT;
  }
}
