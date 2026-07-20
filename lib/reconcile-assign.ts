// Pure reconcile assignment resolver (no I/O) so the Premium reconcile fallback
// path can be unit-tested apart from server actions and database state.

import { isExpenseCategory } from "@/lib/expenses";

export type ReconcileAssignmentInput = {
  category: string;
  propertyId: string | null;
  buildingKey: string | null;
};

export type ResolvedAssignment = {
  category: string;
  propertyId: string | null;
  buildingKey: string | null;
};

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function validCategory(category: string | null | undefined): string {
  const trimmed = (category ?? "").trim();
  return isExpenseCategory(trimmed) ? trimmed : "other";
}

export function chooseReconcileAssignment(
  input: ReconcileAssignmentInput,
  ruleSuggestion: ResolvedAssignment | null,
): ResolvedAssignment {
  const inputPropertyId = nonEmpty(input.propertyId);
  const inputBuildingKey = nonEmpty(input.buildingKey);
  const inputCategory = (input.category ?? "").trim();

  if (isExpenseCategory(inputCategory)) {
    return {
      category: inputCategory,
      propertyId: inputPropertyId,
      buildingKey: inputBuildingKey,
    };
  }

  if (ruleSuggestion) {
    return {
      category: validCategory(ruleSuggestion.category),
      propertyId: nonEmpty(ruleSuggestion.propertyId),
      buildingKey: nonEmpty(ruleSuggestion.buildingKey),
    };
  }

  return { category: "other", propertyId: null, buildingKey: null };
}
