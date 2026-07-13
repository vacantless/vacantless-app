// Immutable N4 snapshot builder — the frozen inputs for a prepared Notice to End
// a Tenancy Early for Non-payment of Rent (Form N4), stored in notices.snapshot
// (migration 0140). Mirrors the N1 snapshot spine (lib/n1-render.ts N1Snapshot):
// the operator reviews the derived figures, we FREEZE them here, and every later
// render/fill reads the snapshot so the served notice can never drift.
//
// PURE: no I/O, no pdf-lib, no DB. Composes the Slice-A logic (lib/n4.ts) into one
// snapshot + a mapper to the fill model (N4FillSnapshot is a type-only import, so
// this module never drags in pdf-lib). Unit-tested in scripts/test-n4-snapshot.ts.
//
// LEGAL POSTURE (design section 4/6): prepare-first. The snapshot is the operator's
// reviewed figures for a notice THEY serve; serve-on-behalf stays gated behind the
// per-form legal-verify pass. The arrears table is derived from the rent + the
// rent_payments ledger and must RECONCILE (no unresolved credits) before it can
// fill the official form — see n4SnapshotBlocker / the fill-time guards.

import {
  deriveN4Arrears,
  deriveN4TerminationDate,
  packN4ArrearsRows,
  resolveN4OwingCents,
  creditN4RowsToTotal,
  type N4FormRow,
  type RentPeriodUnit,
} from "./n4";
import type { PaymentRow } from "./payments";
import type { N4FillSnapshot } from "./n4-official-pdf";

export type N4Snapshot = {
  // Parties + unit (the landlord serves themselves in v1 -> landlord signer).
  landlordName: string;
  landlordPhone: string | null;
  rentalUnitAddress: string | null;
  tenantNames: string[];
  signer: {
    type: "landlord";
    firstName?: string | null;
    lastName?: string | null;
    dayPhone?: string | null;
  };

  // Rent basis for the arrears derive.
  rentCents: number;
  rentPeriodUnit: RentPeriodUnit;

  // Arrears — packed to the official 3-row table, reconciling to totalOwingCents.
  arrearsRows: N4FormRow[];
  computedOwingCents: number; // itemized (upper bound)
  conservativeOwingCents: number; // credits every unattributed payment (lower bound)
  overrideOwingCents: number | null;
  totalOwingCents: number; // the figure ON the form
  hadUnresolvedCredits: boolean;
  unassignedPaidCents: number;
  outOfWindowPaidCents: number;

  // Dates.
  noticeDateISO: string; // arrears "as of" + the service/notice date
  terminationDateISO: string; // pay-by-to-void date = service + min notice

  // Provenance.
  formVersion: string; // N4_TEMPLATE_VERSION at prepare time
  capturedAtIso: string;
};

export type BuildN4Input = {
  landlordName: string;
  landlordPhone?: string | null;
  rentalUnitAddress?: string | null;
  tenantNames: string[];
  signer?: {
    firstName?: string | null;
    lastName?: string | null;
    dayPhone?: string | null;
  };
  rentCents: number;
  startDateISO: string;
  noticeDateISO: string; // the planned service date (arrears as-of + notice date)
  payments: PaymentRow[];
  firstPeriodISO?: string | null;
  rentPeriodUnit?: RentPeriodUnit;
  overrideOwingCents?: number | null;
  formVersion: string;
  capturedAtIso: string;
};

/**
 * Freeze a reviewed N4 into an immutable snapshot. Derives the arrears ledger from
 * the rent + payment records as of the notice date, packs it to the official <=3
 * rows, resolves the total owing (operator override, else the tenant-protective
 * conservative floor), and computes the minimum-notice termination date. Pure.
 */
export function buildN4Snapshot(input: BuildN4Input): N4Snapshot {
  const unit: RentPeriodUnit = input.rentPeriodUnit ?? "monthly";
  const arrears = deriveN4Arrears({
    rentCents: input.rentCents,
    startDateISO: input.startDateISO,
    asOfISO: input.noticeDateISO,
    payments: input.payments,
    firstPeriodISO: input.firstPeriodISO ?? null,
  });
  const packed = packN4ArrearsRows(arrears.rows);
  // Default to the tenant-protective conservative floor (never overstates); an
  // explicit operator override still wins (resolveN4OwingCents).
  const totalOwingCents = resolveN4OwingCents(
    arrears.conservativeOwingCents,
    input.overrideOwingCents,
  );
  // Reconcile the itemized rows to the operator total. A down-override credits
  // the reduction against the most-recent rows (charged-paid=owing preserved,
  // rows sum EXACTLY to the total). An override ABOVE the ledger leaves the rows
  // unchanged so n4SnapshotBlocker can reject it as overstated (a void N4).
  const reconciledRows = creditN4RowsToTotal(packed.formRows, totalOwingCents);
  const terminationDateISO = deriveN4TerminationDate(input.noticeDateISO, unit);

  return {
    landlordName: input.landlordName,
    landlordPhone: input.landlordPhone ?? null,
    rentalUnitAddress: input.rentalUnitAddress ?? null,
    tenantNames: input.tenantNames,
    signer: {
      type: "landlord",
      firstName: input.signer?.firstName ?? null,
      lastName: input.signer?.lastName ?? null,
      dayPhone: input.signer?.dayPhone ?? null,
    },
    rentCents: input.rentCents,
    rentPeriodUnit: unit,
    arrearsRows: reconciledRows,
    computedOwingCents: arrears.computedOwingCents,
    conservativeOwingCents: arrears.conservativeOwingCents,
    overrideOwingCents: input.overrideOwingCents ?? null,
    totalOwingCents,
    hadUnresolvedCredits: arrears.hasUnresolvedCredits,
    unassignedPaidCents: arrears.unassignedPaidCents,
    outOfWindowPaidCents: arrears.outOfWindowPaidCents,
    noticeDateISO: input.noticeDateISO,
    terminationDateISO,
    formVersion: input.formVersion,
    capturedAtIso: input.capturedAtIso,
  };
}

/**
 * Why (if anything) a snapshot cannot yet produce a valid official N4 — the same
 * fail-closed contract fillOfficialN4 enforces, surfaced BEFORE we persist/serve
 * so the operator gets a clear reason instead of a 500. Null = ready to fill.
 */
export function n4SnapshotBlocker(
  snap: N4Snapshot,
): "no_arrears" | "unresolved_credits" | "not_reconciling" | "overstated" | null {
  if (snap.totalOwingCents <= 0) return "no_arrears";
  // Unassigned / out-of-window payments mean the ledger isn't reconciled: the
  // itemized rows (computed) and the conservative total disagree, so the table
  // can't be trusted. Operator assigns the payments to periods first.
  if (snap.hadUnresolvedCredits) return "unresolved_credits";
  if (snap.arrearsRows.length > 3) return "not_reconciling";
  let rowsOwe = 0;
  for (const r of snap.arrearsRows) {
    if (Math.round(r.owingCents || 0) < 0) return "not_reconciling";
    rowsOwe += Math.round(r.owingCents || 0);
  }
  if (rowsOwe > Math.round(snap.totalOwingCents)) return "not_reconciling";
  // The total must never EXCEED what the itemized rows support (an override
  // above the ledger, or any total > summed rows) - that overstates and voids.
  if (Math.round(snap.totalOwingCents) > rowsOwe) return "overstated";
  return null;
}

/** A prepared snapshot is fillable iff there is no blocker. */
export function n4SnapshotReady(snap: N4Snapshot): boolean {
  return n4SnapshotBlocker(snap) === null;
}

/** Map the stored snapshot to the official-form fill model (lib/n4-official-pdf). */
export function snapshotToN4Fill(snap: N4Snapshot): N4FillSnapshot {
  return {
    tenantNames: snap.tenantNames,
    landlordName: snap.landlordName,
    rentalUnitAddress: snap.rentalUnitAddress ?? "",
    totalOwingCents: snap.totalOwingCents,
    terminationDateISO: snap.terminationDateISO,
    arrearsRows: snap.arrearsRows,
    signer: {
      type: "landlord",
      firstName: snap.signer.firstName ?? undefined,
      lastName: snap.signer.lastName ?? undefined,
      dayPhone: snap.signer.dayPhone ?? undefined,
    },
  };
}
