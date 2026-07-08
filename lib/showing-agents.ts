// Pure domain model for multi-operator SHOWING AGENTS + assignment (S436, Slice
// 1 — see DOGFOOD-MULTI-OPERATOR-ROUTING-2026-07-07.md). NO DB, env, or I/O here
// so it unit-tests cleanly via `node -r sucrase/register scripts/test-showing-agents.ts`.
// The impure pieces (the CRUD + assign server actions, the showings + roster
// surfaces) live in app/ and re-validate against THIS module. The routing
// attributes are stored by migration 0113 but only the label/validation/capacity
// helpers are used in Slice 1; Slice 2's suggestOperator() scorer builds on
// PRODUCT_TYPES + remainingCapacity here.

// --- Product types ----------------------------------------------------------
// The suggested set the roster UI offers as checkboxes. Free-text at the DB
// layer (text[]), so an org is never boxed in, but these cover the dogfood
// cases: rental vs sale, and the property shapes Noam routed on.
export const PRODUCT_TYPES = [
  "rental",
  "sale",
  "condo",
  "house",
  "apartment",
] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export function isProductType(value: unknown): value is ProductType {
  return (
    typeof value === "string" &&
    (PRODUCT_TYPES as readonly string[]).includes(value)
  );
}

// Keep only recognized product types, de-duplicated, order-preserved. Anything
// unknown is dropped so a hand-posted form can't wedge junk into the array.
export function normalizeProductTypes(
  values: readonly (string | null | undefined)[] | null | undefined,
): ProductType[] {
  const seen = new Set<string>();
  const out: ProductType[] = [];
  for (const raw of values ?? []) {
    const v = (raw ?? "").trim().toLowerCase();
    if (isProductType(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

// --- Email (self-contained; the pure files don't import each other) ----------
// Deliberately loose — a showing agent's email is optional and only used to send
// them the assignment note. Mirrors the intent of the notifications isValidEmail
// without creating a cross-module dependency in a pure file.
function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// --- Agent input validation --------------------------------------------------
export const MAX_AGENT_NAME_LEN = 120;
export const MAX_AGENT_FIELD_LEN = 200;

export type ShowingAgentInput = {
  name: string;
  email: string | null;
  phone: string | null;
  tier: string | null;
  service_area: string | null;
  product_types: ProductType[];
  weekly_capacity: number | null;
  note: string | null;
};

export type ShowingAgentValidation =
  | { ok: true; value: ShowingAgentInput }
  | { ok: false; code: string };

// Coerce + validate a roster form. Name is the only hard requirement; email, if
// given, must look like an email; weekly_capacity, if given, must be a
// non-negative integer (mirrors the CHECK in 0113). Everything else is trimmed
// free text, empty -> null.
export function validateShowingAgent(raw: {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  tier?: string | null;
  service_area?: string | null;
  product_types?: readonly (string | null | undefined)[] | null;
  weekly_capacity?: string | number | null;
  note?: string | null;
}): ShowingAgentValidation {
  const name = (raw.name ?? "").trim();
  if (name === "") return { ok: false, code: "name_required" };
  if (name.length > MAX_AGENT_NAME_LEN) return { ok: false, code: "name_too_long" };

  const trimOrNull = (v: string | null | undefined): string | null => {
    const t = (v ?? "").trim();
    if (t === "") return null;
    return t.length > MAX_AGENT_FIELD_LEN ? t.slice(0, MAX_AGENT_FIELD_LEN) : t;
  };

  const email = trimOrNull(raw.email);
  if (email !== null && !looksLikeEmail(email)) {
    return { ok: false, code: "email_invalid" };
  }

  let weekly_capacity: number | null = null;
  if (raw.weekly_capacity !== null && raw.weekly_capacity !== undefined && `${raw.weekly_capacity}`.trim() !== "") {
    const n = typeof raw.weekly_capacity === "number" ? raw.weekly_capacity : Number(raw.weekly_capacity);
    if (!Number.isInteger(n) || n < 0) return { ok: false, code: "capacity_invalid" };
    weekly_capacity = n;
  }

  return {
    ok: true,
    value: {
      name,
      email: email ? email.toLowerCase() : null,
      phone: trimOrNull(raw.phone),
      tier: trimOrNull(raw.tier),
      service_area: trimOrNull(raw.service_area),
      product_types: normalizeProductTypes(raw.product_types),
      weekly_capacity,
      note: trimOrNull(raw.note),
    },
  };
}

// --- Assignment state --------------------------------------------------------
// A viewing can be assigned/reassigned/unassigned while it is still LIVE. A
// CANCELLED viewing is a closed record — nobody needs to be dispatched to it, so
// assignment is blocked (mirror-checked in the server action before the UPDATE).
// 'scheduled' (upcoming), 'attended', and 'no_show' are all assignable (you may
// want the same agent to follow up on a no-show).
export function canAssignShowing(outcome: string | null | undefined): boolean {
  return (outcome ?? "") !== "cancelled";
}

// --- Capacity (seeds Slice 2 routing) ---------------------------------------
// How many more viewings an agent can take this week. NULL capacity == uncapped
// (returns null, meaning "no limit"). A negative remainder is floored at 0 so an
// over-booked agent reads as "full", not a negative number.
export function remainingCapacity(
  weeklyCapacity: number | null | undefined,
  assignedThisWeek: number,
): number | null {
  if (weeklyCapacity == null) return null;
  return Math.max(0, weeklyCapacity - Math.max(0, assignedThisWeek));
}

export function isAtCapacity(
  weeklyCapacity: number | null | undefined,
  assignedThisWeek: number,
): boolean {
  const r = remainingCapacity(weeklyCapacity, assignedThisWeek);
  return r !== null && r <= 0;
}

// --- View helpers ------------------------------------------------------------
export type ShowingAgentSummary = {
  id: string;
  name: string;
  tier: string | null;
  archived: boolean;
};

// The label shown on a showing row / in a picker. Tier is appended in parens
// when set so "Peter (lead)" reads at a glance. No em dashes (house style).
export function agentDisplayLabel(agent: {
  name: string | null | undefined;
  tier?: string | null;
}): string {
  const name = (agent.name ?? "").trim() || "Unnamed agent";
  const tier = (agent.tier ?? "").trim();
  return tier ? `${name} (${tier})` : name;
}

// Active roster for a picker: drop archived agents, keep source order. An
// already-assigned-but-now-archived agent is handled by the caller (it still
// shows on the row it's assigned to, just not as a new choice).
export function activeAgents<T extends { archived: boolean }>(agents: readonly T[]): T[] {
  return agents.filter((a) => !a.archived);
}
