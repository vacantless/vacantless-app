export const PIPELINE_STAGES = [
  "new",
  "replied",
  "contacted",
  "booked",
  "showed",
  "applied",
  "leased",
  "lost",
] as const;

export type LeadStatus = (typeof PIPELINE_STAGES)[number];

const LABELS: Record<LeadStatus, string> = {
  new: "New",
  replied: "Replied",
  contacted: "Contacted",
  booked: "Booked",
  showed: "Showed",
  applied: "Applied",
  leased: "Leased",
  lost: "Lost",
};

export function statusLabel(status: string): string {
  return (LABELS as Record<string, string>)[status] ?? status;
}

export function isLeadStatus(value: string): value is LeadStatus {
  return (PIPELINE_STAGES as readonly string[]).includes(value);
}

export const PROPERTY_STATUSES = ["available", "leased", "off_market"] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

export function propertyStatusLabel(status: string): string {
  if (status === "off_market") return "Off market";
  return status.charAt(0).toUpperCase() + status.slice(1);
}
