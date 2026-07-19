import { categoryFromRawHint, type ExpenseCategory } from "../expenses";

export type MappedDisposition =
  | { kind: "expense"; category: ExpenseCategory }
  | { kind: "rent" }
  | { kind: "excluded" }
  | { kind: "unknown" };

const PERSONAL_OR_NON_RENTAL =
  /\b(government|benefits?|canada essentials?|fed[\s-]?prov|transfer|paypal|refund(?:ed)?|personal|owner draw|owner contribution)\b/;

const FRESHBOOKS_EXPENSE_KEYS: Array<[RegExp, ExpenseCategory]> = [
  [/\bproperty\s*tax(?:es)?\b/, "property_tax"],
  [/\b(maintenance|repairs?)\b/, "maintenance"],
  [/\bmortgage\b/, "mortgage"],
  [/\binsurance\b/, "insurance"],
  [/\b(utilit|hydro|gas|water)\b/, "utilities"],
  [/\b(condo|hoa)\b/, "condo_fees"],
  [/\b(bank|interest|service charge)\b/, "interest"],
  [/\b(advertis|marketing)\b/, "advertising"],
  [/\b(legal|account|professional)\b/, "professional"],
  [/\bmanagement\b/, "management"],
  [/\b(supplies|office)\b/, "supplies"],
];

export function mapSourceCategory(
  sourceCategory: string | null,
  direction: "debit" | "credit",
): MappedDisposition {
  const raw = (sourceCategory ?? "").trim();
  if (raw === "") return { kind: "unknown" };

  const s = raw.toLowerCase();
  if (PERSONAL_OR_NON_RENTAL.test(s)) return { kind: "excluded" };
  if (direction === "credit" && /\b(rental income|rent)\b/.test(s)) {
    return { kind: "rent" };
  }

  for (const [pattern, category] of FRESHBOOKS_EXPENSE_KEYS) {
    if (pattern.test(s)) return { kind: "expense", category };
  }

  const hinted = categoryFromRawHint(raw);
  return hinted === "other" ? { kind: "unknown" } : { kind: "expense", category: hinted };
}
