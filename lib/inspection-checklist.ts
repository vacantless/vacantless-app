export const CHECKLIST_CONDITIONS = [
  "good",
  "fair",
  "poor",
  "damaged",
  "na",
] as const;

export type ChecklistCondition = (typeof CHECKLIST_CONDITIONS)[number];

const CHECKLIST_CONDITION_LABELS: Record<ChecklistCondition, string> = {
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  damaged: "Damaged",
  na: "N/A",
};

export type ChecklistItemInput = {
  area?: string | null;
  item: string;
  condition?: string | null;
  note?: string | null;
  sort_order?: number;
};

export type NormalizedChecklistItem = {
  area: string | null;
  item: string;
  condition: ChecklistCondition | null;
  note: string | null;
};

export const DEFAULT_CHECKLIST_TEMPLATE: ReadonlyArray<{
  area: string;
  items: readonly string[];
}> = [
  {
    area: "Kitchen",
    items: ["Countertops", "Cabinets", "Sink & faucet", "Appliances", "Flooring"],
  },
  {
    area: "Bathroom",
    items: ["Toilet", "Sink & vanity", "Tub/shower", "Flooring", "Ventilation"],
  },
  {
    area: "Bedroom",
    items: ["Walls", "Flooring", "Closet", "Windows"],
  },
  {
    area: "Living/Common",
    items: ["Walls", "Flooring", "Ceiling", "Windows", "Doors"],
  },
  {
    area: "General",
    items: ["Smoke/CO detectors", "Keys/fobs", "Locks", "Light fixtures"],
  },
];

export function isChecklistCondition(v: string): v is ChecklistCondition {
  return (CHECKLIST_CONDITIONS as readonly string[]).includes(v);
}

export function checklistConditionLabel(
  v: string | null | undefined,
): string {
  const clean = (v ?? "").trim();
  return isChecklistCondition(clean)
    ? CHECKLIST_CONDITION_LABELS[clean]
    : "Not rated";
}

export function buildDefaultChecklistItems(): ChecklistItemInput[] {
  const rows: ChecklistItemInput[] = [];
  for (const section of DEFAULT_CHECKLIST_TEMPLATE) {
    for (const item of section.items) {
      rows.push({
        area: section.area,
        item,
        condition: null,
        note: null,
        sort_order: rows.length,
      });
    }
  }
  return rows;
}

export function normalizeChecklistItem(
  raw: ChecklistItemInput,
): NormalizedChecklistItem | null {
  const item = String(raw.item ?? "").trim();
  if (!item) return null;

  const area = String(raw.area ?? "").trim() || null;
  const conditionRaw = String(raw.condition ?? "").trim();
  const note = String(raw.note ?? "").trim() || null;

  return {
    area,
    item,
    condition: isChecklistCondition(conditionRaw) ? conditionRaw : null,
    note,
  };
}
