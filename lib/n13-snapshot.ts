// S751: the frozen inputs for a prepared Form N13, stored in notices.snapshot
// (type 'N13'). Every later download fills from this snapshot, so the served
// notice can never drift from what the landlord reviewed. Pure: no I/O.

import type { N12ServiceMethod } from "./n12";
import {
  earliestN13TerminationDate,
  n13CompensationCents,
  n13Problems,
  type N13Permits,
  type N13Problem,
  type N13Reason,
} from "./n13";
import type { N13FillSnapshot } from "./n13-official-pdf";

export type N13Snapshot = {
  tenantNames: string[];
  landlordName: string;
  rentalUnitAddress: string | null;
  serviceDateISO: string;
  method: N12ServiceMethod;
  dueDay: number;
  fixedTermEndISO: string | null;
  mobileHome: boolean;
  terminationDateISO: string;
  earliestTerminationISO: string;
  reason: N13Reason;
  workPlanned: string;
  workDetails: string;
  permits: N13Permits;
  residentialUnits: number;
  orderedUnderAct: boolean;
  compensationRequired: boolean;
  /** 1 or 3 months' rent (mobile home: lesser of a year's rent or $3,000). */
  compensationCents: number | null;
  signer: { firstName: string | null; lastName: string | null; phone: string | null };
  formVersion: string;
  capturedAtIso: string;
};

export type BuildN13Input = Omit<
  N13Snapshot,
  "earliestTerminationISO" | "compensationRequired" | "compensationCents" | "terminationDateISO"
> & {
  rentCents: number | null;
  /** Blank = the earliest valid date. */
  terminationDateISO?: string | null;
};

export function buildN13Snapshot(input: BuildN13Input): { snapshot: N13Snapshot; problems: N13Problem[] } {
  const dateInput = {
    serviceDateISO: input.serviceDateISO,
    method: input.method,
    dueDay: input.dueDay,
    fixedTermEndISO: input.fixedTermEndISO,
    mobileHome: input.mobileHome,
  };
  const earliest = earliestN13TerminationDate(dateInput);
  const terminationDateISO = input.terminationDateISO || earliest;
  const compensationCents = n13CompensationCents({
    rentCents: input.rentCents,
    residentialUnits: input.residentialUnits,
    mobileHome: input.mobileHome,
    orderedUnderAct: input.orderedUnderAct,
  });
  const { rentCents: _rent, ...rest } = input;
  void _rent;
  const snapshot: N13Snapshot = {
    ...rest,
    workPlanned: input.workPlanned.trim(),
    workDetails: input.workDetails.trim(),
    terminationDateISO,
    earliestTerminationISO: earliest,
    compensationRequired: !input.orderedUnderAct,
    compensationCents,
  };
  const problems = n13Problems({ ...dateInput, ...snapshot });
  return { snapshot, problems };
}

export function snapshotToN13Fill(s: N13Snapshot): N13FillSnapshot {
  return {
    tenantNames: s.tenantNames,
    landlordName: s.landlordName,
    rentalUnitAddress: s.rentalUnitAddress,
    terminationDateISO: s.terminationDateISO,
    reason: s.reason,
    workPlanned: s.workPlanned,
    workDetails: s.workDetails,
    permits: s.permits,
    signer: s.signer,
  };
}
