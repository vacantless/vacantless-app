export const UTILITY_TASK_STATUSES = [
  "todo",
  "in_progress",
  "done",
  "na",
] as const;

export type UtilityTaskStatus = (typeof UTILITY_TASK_STATUSES)[number];

export const RESPONSIBLE_PARTIES = ["tenant", "landlord", "na"] as const;

export type ResponsibleParty = (typeof RESPONSIBLE_PARTIES)[number];

const UTILITY_TASK_STATUS_LABELS: Record<UtilityTaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  na: "N/A",
};

const RESPONSIBLE_PARTY_LABELS: Record<ResponsibleParty, string> = {
  tenant: "Tenant",
  landlord: "Landlord",
  na: "N/A",
};

export type UtilityTaskInput = {
  label: string;
  responsible_party?: string;
  target_date?: string | null;
  status?: string;
  confirmation_note?: string | null;
  sort_order?: number;
};

export type NormalizedUtilityTask = {
  label: string;
  responsible_party: ResponsibleParty;
  target_date: string | null;
  status: UtilityTaskStatus;
  confirmation_note: string | null;
};

export const DEFAULT_UTILITY_TASKS: ReadonlyArray<{
  label: string;
  responsible_party: "tenant" | "landlord";
}> = [
  { label: "Hydro transfer", responsible_party: "tenant" },
  { label: "Gas transfer", responsible_party: "tenant" },
  { label: "Water account", responsible_party: "tenant" },
  { label: "Internet", responsible_party: "tenant" },
  { label: "Tenant insurance proof", responsible_party: "tenant" },
  { label: "Mail forwarding", responsible_party: "tenant" },
];

export function isUtilityTaskStatus(v: string): v is UtilityTaskStatus {
  return (UTILITY_TASK_STATUSES as readonly string[]).includes(v);
}

export function utilityTaskStatusLabel(
  v: string | null | undefined,
): string {
  const clean = (v ?? "").trim();
  return isUtilityTaskStatus(clean)
    ? UTILITY_TASK_STATUS_LABELS[clean]
    : UTILITY_TASK_STATUS_LABELS.todo;
}

export function isResponsibleParty(v: string): v is ResponsibleParty {
  return (RESPONSIBLE_PARTIES as readonly string[]).includes(v);
}

export function responsiblePartyLabel(
  v: string | null | undefined,
): string {
  const clean = (v ?? "").trim();
  return isResponsibleParty(clean)
    ? RESPONSIBLE_PARTY_LABELS[clean]
    : RESPONSIBLE_PARTY_LABELS.tenant;
}

export function buildDefaultUtilityTasks(): UtilityTaskInput[] {
  return DEFAULT_UTILITY_TASKS.map((task, index) => ({
    label: task.label,
    responsible_party: task.responsible_party,
    target_date: null,
    status: "todo",
    confirmation_note: null,
    sort_order: index,
  }));
}

function normalizeDate(raw: string | null | undefined): string | null {
  const clean = String(raw ?? "").trim();
  if (!clean) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return clean;
}

export function normalizeUtilityTask(
  raw: UtilityTaskInput,
): NormalizedUtilityTask | null {
  const label = String(raw.label ?? "").trim();
  if (!label) return null;

  const responsibleRaw = String(raw.responsible_party ?? "").trim();
  const statusRaw = String(raw.status ?? "").trim();

  return {
    label,
    responsible_party: isResponsibleParty(responsibleRaw)
      ? responsibleRaw
      : "tenant",
    target_date: normalizeDate(raw.target_date),
    status: isUtilityTaskStatus(statusRaw) ? statusRaw : "todo",
    confirmation_note: String(raw.confirmation_note ?? "").trim() || null,
  };
}
