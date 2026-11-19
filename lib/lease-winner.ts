// S820e: when a unit is marked Rented (a crew tap on the unit progress link,
// or the landlord's Leased save), the renter who signed the accepted offer in
// Vacantless moves to Leased too, so Renters matches the unit. Only that case:
// a signed offer is proof. Being sent an application (ours or the account's
// Buildium link) is not: on an own-form account the real tenant may have
// applied in that system without ever being a renter here (Noam, 2026-11-19).
// Two accepted offers, or none: nobody changes. Pure.

export type LeaseCandidate = {
  id: string;
  status: string | null;
  acceptedOffer: boolean;
};

const CLOSED = new Set(["leased", "lost"]);

export function pickLeaseWinner(candidates: LeaseCandidate[]): string | null {
  const offered = candidates.filter((c) => !CLOSED.has(c.status ?? "") && c.acceptedOffer);
  return offered.length === 1 ? offered[0].id : null;
}

export const LEASE_WINNER_NOTE = "Marked Leased when the unit was marked Rented: they signed the accepted offer.";
