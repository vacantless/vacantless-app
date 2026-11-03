// S748c: take each Stripe event once (the S742 review, engineering item 9).
// Stripe delivers webhooks at least once and retries on any non-2xx or
// timeout, and the platform and Connect destinations can both deliver. The
// claim is a primary-key insert on stripe_webhook_events:
//   new        -> process it
//   duplicate  -> already taken; acknowledge and skip
//   unknown    -> the claim table could not be reached; process anyway (the
//                 writes below are idempotent, so failing open is safe)
// A run that fails releases its claim so Stripe's retry is processed.

export type ClaimResult = "new" | "duplicate" | "unknown";

type InsertResult = { error: { code?: string; message?: string } | null };
export type ClaimClient = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<InsertResult>;
    delete: () => {
      eq: (column: string, value: unknown) => PromiseLike<unknown>;
      lt?: (column: string, value: unknown) => PromiseLike<unknown>;
    };
  };
};

export const CLAIM_TABLE = "stripe_webhook_events";

export async function claimStripeEvent(
  client: unknown,
  eventId: string | null | undefined,
  type?: string | null,
): Promise<ClaimResult> {
  // Typed loosely so a Supabase client and a test fake both fit.
  const admin = client as ClaimClient | null | undefined;
  if (!admin || !eventId) return "unknown";
  try {
    const { error } = await admin.from(CLAIM_TABLE).insert({ event_id: eventId, type: type ?? null });
    if (!error) {
      // Keep the table small: now and then drop claims older than 60 days
      // (Stripe stops retrying after 3 days).
      if (Math.random() < 0.01) {
        const del = admin.from(CLAIM_TABLE).delete();
        if (del.lt) await del.lt("received_at", new Date(Date.now() - 60 * 86_400_000).toISOString());
      }
      return "new";
    }
    if (error.code === "23505") return "duplicate";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/** Undo a claim after a failed run, so Stripe's retry is processed. Never throws. */
export async function releaseStripeEvent(
  client: unknown,
  eventId: string | null | undefined,
): Promise<void> {
  const admin = client as ClaimClient | null | undefined;
  if (!admin || !eventId) return;
  try {
    await admin.from(CLAIM_TABLE).delete().eq("event_id", eventId);
  } catch {
    // the retry will be skipped as a duplicate; the writes are idempotent anyway
  }
}
