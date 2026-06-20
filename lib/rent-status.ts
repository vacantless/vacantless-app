// ============================================================================
// Rent-collection "active" signal (IA Step 1, S274).
//
// One place the "does this org have a usable rent rail?" rule lives, so the
// dashboard nav (whether to show the conditional Money item) and any future
// surface (the spine's rent-setup step, the Money page) all agree.
//
// Pure — no DOM / env / IO (see scripts/test-rent-status.ts). The impure fetch
// of the two underlying rows happens in app/dashboard/layout.tsx.
//
// Definition (locked S274, Noam-confirmed): rent collection is ACTIVE when the
// org has connected EITHER rail —
//   * Stripe Connect  charges_enabled === true, OR
//   * Rotessa         connection_status === "connected".
// Deliberately NOT requiring a scheduled rent: connecting a rail should be
// enough to reveal Money / finish setup, not gated behind the first schedule.
// ============================================================================

/** Rotessa's connected sentinel (mirrors lib/rotessa ROTESSA_CONNECTION_STATUSES). */
export const ROTESSA_CONNECTED = "connected" as const;

export type RentStatusInputs = {
  /** stripe_connect_accounts.charges_enabled for the org (null = no account). */
  stripeChargesEnabled?: boolean | null;
  /** rotessa_accounts.connection_status for the org (null = no account). */
  rotessaConnectionStatus?: string | null;
};

/**
 * True when the org can collect rent through at least one connected rail.
 * See the module header for the locked definition.
 */
export function isRentCollectionActive(input: RentStatusInputs): boolean {
  return (
    input.stripeChargesEnabled === true ||
    input.rotessaConnectionStatus === ROTESSA_CONNECTED
  );
}
