import type {
  RentAdjustmentKind,
  RentAdjustmentSource,
  ResolvedRentReconciliation,
} from "./rent-adjustments";
import { envFlagEnabled } from "./auto-listing-copy";

type SupabaseLike = {
  from: (table: string) => any;
};

export function leaseTermShiftEnabled(
  value: string | null | undefined = process.env.LEASE_TERM_SHIFT_ENABLED,
): boolean {
  return envFlagEnabled(value);
}

export async function hasConfirmedRentLedger(
  supabase: SupabaseLike,
  tenancyId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("tenancy_rent_adjustments")
    .select("id")
    .eq("tenancy_id", tenancyId)
    .limit(1);
  if (error) {
    console.error("hasConfirmedRentLedger failed", { tenancyId, error: error.message });
    return false;
  }
  return (data ?? []).length > 0;
}

export async function insertRentAdjustmentRows(args: {
  supabase: SupabaseLike;
  orgId: string;
  tenancyId: string;
  rows: Array<{
    effectiveDate: string;
    rentCents: number;
    kind: RentAdjustmentKind;
    source: RentAdjustmentSource;
    note: string | null;
  }>;
  createdBy?: string | null;
}) {
  if (args.rows.length === 0) return;
  const nowMs = Date.now();
  const { error } = await args.supabase.from("tenancy_rent_adjustments").insert(
    args.rows.map((row, index) => ({
      organization_id: args.orgId,
      tenancy_id: args.tenancyId,
      effective_date: row.effectiveDate,
      rent_cents: row.rentCents,
      kind: row.kind,
      source: row.source,
      note: row.note,
      created_by: args.createdBy ?? null,
      created_at: new Date(nowMs + index).toISOString(),
    })),
  );
  if (error) {
    throw new Error(`rent_adjustment_insert_failed:${error.message}`);
  }
}

export async function seedConfirmedRentLedger(args: {
  supabase: SupabaseLike;
  orgId: string;
  tenancyId: string;
  reconciliation: ResolvedRentReconciliation;
  createdBy?: string | null;
}) {
  await insertRentAdjustmentRows({
    supabase: args.supabase,
    orgId: args.orgId,
    tenancyId: args.tenancyId,
    rows: args.reconciliation.rows,
    createdBy: args.createdBy ?? null,
  });
  const { error } = await args.supabase
    .from("tenancies")
    .update({
      rent_cents: args.reconciliation.currentRentCents,
      last_rent_increase_date: args.reconciliation.lastIncreaseDate,
      rent_increase_nudged_for: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.tenancyId);
  if (error) {
    throw new Error(`rent_adjustment_sync_failed:${error.message}`);
  }
}

export async function appendN1RentAdjustment(args: {
  supabase: SupabaseLike;
  orgId: string;
  tenancyId: string;
  effectiveDate: string;
  rentCents: number;
  createdBy?: string | null;
}) {
  await insertRentAdjustmentRows({
    supabase: args.supabase,
    orgId: args.orgId,
    tenancyId: args.tenancyId,
    rows: [
      {
        effectiveDate: args.effectiveDate,
        rentCents: args.rentCents,
        kind: "increase",
        source: "n1",
        note: "Recorded served rent increase.",
      },
    ],
    createdBy: args.createdBy ?? null,
  });
}
