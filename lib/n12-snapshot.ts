// S748g: the frozen inputs for a prepared Form N12, stored in notices.snapshot
// (type 'N12'). Every later download fills from this snapshot, so the served
// notice can never drift from what the landlord reviewed. Pure: no I/O.

import {
  earliestN12TerminationDate,
  n12CompensationRequired,
  n12NoCompensationDate,
  n12Problems,
  type N12Problem,
  type N12Reason,
  type N12Relationship,
  type N12ServiceMethod,
} from "./n12";
import type { N12FillSnapshot } from "./n12-official-pdf";

export type N12Snapshot = {
  tenantNames: string[];
  landlordName: string;
  landlordIsIndividual: boolean;
  rentalUnitAddress: string | null;
  serviceDateISO: string;
  method: N12ServiceMethod;
  dueDay: number;
  fixedTermEndISO: string | null;
  terminationDateISO: string;
  earliestTerminationISO: string;
  noCompensationDateISO: string;
  compensationRequired: boolean;
  compensationCents: number | null; // one month's rent when owed
  reason: N12Reason;
  personName: string;
  relationship: N12Relationship;
  careProvider: boolean;
  signer: { firstName: string | null; lastName: string | null; phone: string | null };
  formVersion: string;
  capturedAtIso: string;
};

export type BuildN12Input = Omit<
  N12Snapshot,
  "earliestTerminationISO" | "noCompensationDateISO" | "compensationRequired" | "compensationCents" | "terminationDateISO"
> & {
  rentCents: number | null;
  /** Blank = the earliest valid date. */
  terminationDateISO?: string | null;
};

export function buildN12Snapshot(input: BuildN12Input): { snapshot: N12Snapshot; problems: N12Problem[] } {
  const dateInput = {
    serviceDateISO: input.serviceDateISO,
    method: input.method,
    dueDay: input.dueDay,
    fixedTermEndISO: input.fixedTermEndISO,
  };
  const earliest = earliestN12TerminationDate(dateInput);
  const noComp = n12NoCompensationDate(dateInput);
  const terminationDateISO = input.terminationDateISO || earliest;
  const compensationRequired = n12CompensationRequired({
    reason: input.reason,
    serviceDateISO: input.serviceDateISO,
    method: input.method,
    terminationDateISO,
  });
  const { rentCents, ...rest } = input;
  const snapshot: N12Snapshot = {
    ...rest,
    terminationDateISO,
    earliestTerminationISO: earliest,
    noCompensationDateISO: noComp,
    compensationRequired,
    compensationCents: compensationRequired ? rentCents ?? null : null,
  };
  const problems = n12Problems({ ...dateInput, ...snapshot });
  return { snapshot, problems };
}

export function snapshotToN12Fill(s: N12Snapshot): N12FillSnapshot {
  return {
    tenantNames: s.tenantNames,
    landlordName: s.landlordName,
    rentalUnitAddress: s.rentalUnitAddress,
    terminationDateISO: s.terminationDateISO,
    reason: s.reason,
    personName: s.personName,
    relationship: s.relationship,
    careProvider: s.careProvider,
    signer: s.signer,
  };
}
