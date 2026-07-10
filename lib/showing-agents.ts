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

// --- Coordination status (Slice 2 — the "Howard" follow-up trail) ------------
// The lifecycle state of a viewing's coordination, so a lead agent can see at a
// glance whether an assigned viewing has actually been confirmed with the renter
// instead of guessing. Derived (never stored) from the three source columns.
//   cancelled              - outcome cancelled; coordination is moot.
//   done                   - outcome recorded (attended / no_show); in the past.
//   unassigned             - upcoming, no agent routed yet.
//   awaiting_confirmation  - upcoming, assigned, but not confirmed with the renter.
//   confirmed              - upcoming, assigned, and confirmed with the renter.
export const COORDINATION_STATUSES = [
  "cancelled",
  "done",
  "unassigned",
  "awaiting_confirmation",
  "confirmed",
] as const;
export type CoordinationStatus = (typeof COORDINATION_STATUSES)[number];

export function deriveCoordinationStatus(args: {
  outcome: string | null | undefined;
  assignedAgentId: string | null | undefined;
  confirmedAt: string | null | undefined;
}): CoordinationStatus {
  const outcome = args.outcome ?? "";
  if (outcome === "cancelled") return "cancelled";
  if (outcome === "attended" || outcome === "no_show") return "done";
  if (!args.assignedAgentId) return "unassigned";
  if (!args.confirmedAt) return "awaiting_confirmation";
  return "confirmed";
}

// A viewing "needs a confirmation nudge" only when it is assigned-but-unconfirmed.
export function needsConfirmation(status: CoordinationStatus): boolean {
  return status === "awaiting_confirmation";
}

const COORDINATION_LABELS: Record<CoordinationStatus, string> = {
  cancelled: "Cancelled",
  done: "Done",
  unassigned: "Unassigned",
  awaiting_confirmation: "Awaiting confirmation",
  confirmed: "Confirmed",
};

export function coordinationStatusLabel(status: CoordinationStatus): string {
  return COORDINATION_LABELS[status];
}

// A viewing can be marked confirmed only when it is currently in the
// awaiting_confirmation state (assigned + upcoming + not yet confirmed). Mirrored
// in the server action guard.
export function canConfirmShowing(status: CoordinationStatus): boolean {
  return status === "awaiting_confirmation";
}

// --- Suggested agent (S441 — the assist on the assign picker) ----------------
// A HINT, never an auto-assign. Given the active roster + how many viewings each
// agent already has THIS WEEK, pick the agent to route the next viewing to and
// say WHY, so a lead agent spreading showings across a #2/#3 doesn't have to
// track everyone's load in their head. The operator still picks anyone from the
// dropdown; this just pre-computes the sensible default. All pure + tested.

// The org-local week the capacity load is measured over. Sunday-start by
// default (matches the leasing week most operators think in). Returns the UTC
// [startMs, endMs) instants that bound the local week containing `nowMs`, so the
// caller can bucket showings by scheduled_at without a tz library. Self-
// contained (the pure files don't import each other) — mirrors the Intl wall-
// component round-trip proven in lib/leasing-snapshot.ts.
const WEEK_MS = 7 * 24 * 3_600_000;

export function orgWeekWindow(
  nowMs: number,
  tz: string,
  weekStartsOn = 0,
): { startMs: number; endMs: number } {
  let y = 1970,
    mo = 1,
    d = 1,
    h = 0,
    mi = 0,
    s = 0,
    wd = new Date(nowMs).getUTCDay();
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      weekday: "short",
    });
    const map: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date(nowMs))) {
      if (p.type !== "literal") map[p.type] = p.value;
    }
    y = Number(map.year);
    mo = Number(map.month);
    d = Number(map.day);
    h = map.hour === "24" ? 0 : Number(map.hour);
    mi = Number(map.minute);
    s = Number(map.second);
    // Weekday of the LOCAL calendar date (not the UTC instant).
    wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  } catch {
    const dt = new Date(nowMs);
    y = dt.getUTCFullYear();
    mo = dt.getUTCMonth() + 1;
    d = dt.getUTCDate();
    h = dt.getUTCHours();
    mi = dt.getUTCMinutes();
    s = dt.getUTCSeconds();
    wd = dt.getUTCDay();
  }
  // Back out the tz offset from the local wall-clock to get local-midnight-today
  // as a UTC instant (asUTC - now == how far local leads UTC).
  // KNOWN EDGE (Codex S441 P3, ACCEPTED): the offset sampled at `now` is applied
  // to the whole week, so a DST-transition week's Sunday boundary can be off by an
  // hour — affecting only a viewing scheduled in that single ambiguous hour twice a
  // year. This mirrors the accepted local-midnight simplification in
  // lib/leasing-snapshot.ts (KI508); not worth diverging for a capacity HINT.
  const asUTC = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsetMs = asUTC - Math.floor(nowMs / 1000) * 1000;
  const startTodayMs = Date.UTC(y, mo - 1, d) - offsetMs;
  const daysIntoWeek = (wd - weekStartsOn + 7) % 7;
  const startMs = startTodayMs - daysIntoWeek * 24 * 3_600_000;
  return { startMs, endMs: startMs + WEEK_MS };
}

export type SuggestCandidate = {
  id: string;
  name: string;
  tier: string | null;
  productTypes: ProductType[];
  weeklyCapacity: number | null;
  // Non-cancelled viewings already assigned to this agent within the current
  // org-local week (computed by the caller from scheduled_at + orgWeekWindow).
  assignedThisWeek: number;
  archived: boolean;
};

export type AgentSuggestion = {
  agentId: string;
  name: string;
  reason: string;
  atCapacity: boolean;
};

// Pick the agent to suggest for the next viewing. Ranking, most-significant
// first: (1) product-type fit — only when it actually discriminates (some active
// agent covers the viewing's type); an agent with NO product types set is a
// generalist and always eligible; (2) most remaining weekly capacity (uncapped
// counts as unlimited); (3) fewest viewings already this week (load balance);
// (4) name, for a stable, deterministic tie-break. Returns null when the roster
// has no active agent to suggest.
export function suggestShowingAgent(
  candidates: readonly SuggestCandidate[],
  opts?: { productType?: ProductType | null },
): AgentSuggestion | null {
  const active = candidates.filter((c) => !c.archived);
  if (active.length === 0) return null;

  // Product-type fit is a soft filter: narrow to agents who either declare the
  // viewing's product type or declare none at all (generalists), but ONLY if
  // that leaves someone — never suggest nobody because of a type mismatch.
  const productType = opts?.productType ?? null;
  let narrowedByProduct = false;
  let pool = active;
  if (productType) {
    // Drop agents who specialize in OTHER product types — a sale-only agent must
    // never win a rental suggestion over a generalist, even when NO rental
    // specialist exists (Codex S441 P3). An agent with no product_types is a
    // generalist and always stays eligible. Only narrow when it actually leaves
    // someone; if EVERY active agent is a wrong-type specialist, keep them all
    // rather than suggest nobody. (`narrowedByProduct` only drives the "covers X"
    // reason, which is separately gated on the winner truly covering the type, so
    // a generalist winner never falsely claims coverage.)
    const fit = active.filter(
      (c) => c.productTypes.length === 0 || c.productTypes.includes(productType),
    );
    if (fit.length > 0 && fit.length < active.length) {
      pool = fit;
      narrowedByProduct = true;
    }
  }

  const remaining = (c: SuggestCandidate): number => {
    const r = remainingCapacity(c.weeklyCapacity, c.assignedThisWeek);
    return r === null ? Number.POSITIVE_INFINITY : r;
  };

  const winner = [...pool].sort((a, b) => {
    // Most remaining capacity first. Two uncapped agents compare equal (Infinity
    // === Infinity) and fall through to load-balance — subtracting them would be
    // NaN and corrupt the sort.
    const ra = remaining(a);
    const rb = remaining(b);
    if (ra !== rb) return rb - ra;
    if (a.assignedThisWeek !== b.assignedThisWeek)
      return a.assignedThisWeek - b.assignedThisWeek;
    return a.name.localeCompare(b.name);
  })[0];

  const atCapacity = isAtCapacity(winner.weeklyCapacity, winner.assignedThisWeek);

  // Build a short, truthful reason from the deciding factors.
  const parts: string[] = [];
  if (narrowedByProduct && winner.productTypes.includes(productType!)) {
    parts.push(`covers ${productType}`);
  }
  if (winner.weeklyCapacity != null) {
    const left = remainingCapacity(winner.weeklyCapacity, winner.assignedThisWeek) ?? 0;
    parts.push(
      `${left} of ${winner.weeklyCapacity} ${left === 1 ? "viewing" : "viewings"} left this week`,
    );
  } else if (pool.some((c) => c.assignedThisWeek > 0)) {
    parts.push(
      winner.assignedThisWeek === 0
        ? "no viewings yet this week"
        : `fewest viewings this week (${winner.assignedThisWeek})`,
    );
  } else {
    parts.push("available");
  }
  const reason = parts.join(" · ");

  return { agentId: winner.id, name: winner.name, reason, atCapacity };
}

// --- Auto-assign (S443 — the suggestion, applied automatically at booking) ----
// Same load-balanced pick as suggestShowingAgent, but for the UNATTENDED path:
// when an org opts in, a newly self-booked viewing is routed automatically with
// no operator in the loop. The one difference from the manual assist is that
// auto-assign REFUSES to route to an agent who is at their weekly capacity.
// suggestShowingAgent ranks by most-remaining-capacity first, so its winner is
// only at capacity when EVERY active agent is at/over capacity — in that case
// auto-assign returns null so the viewing stays unassigned and surfaces for
// manual routing (the operator can still override a full agent by hand), rather
// than silently piling onto someone who is already full. An empty/all-archived
// roster likewise yields null (a no-op booking), so turning the flag on for an
// org with no agents changes nothing. Pure + tested; the impure booking action
// re-checks org scope + open outcome before it writes.
export function pickAutoAssignAgent(
  candidates: readonly SuggestCandidate[],
  opts?: { productType?: ProductType | null },
): AgentSuggestion | null {
  const suggestion = suggestShowingAgent(candidates, opts);
  if (!suggestion || suggestion.atCapacity) return null;
  return suggestion;
}

// --- Bulk auto-assign (S444 — the operator-initiated "Assign all unassigned") -
// The batch companion to per-booking auto-assign: route EVERY currently-
// unassigned upcoming viewing through the same load-balanced, capacity-respecting
// pick in ONE pass. Kept pure so the batch's load-accounting — the one thing a
// single per-viewing pick can't get right on its own — is unit-tested
// deterministically; the impure action just executes the returned plan (a guarded
// UPDATE per row, idempotent vs a concurrent manual assign, org-scoped in SQL).
//
// The subtlety this solves: capacity + load balance are measured PER org-local
// WEEK (a viewing counts against the week it falls in — the S443 P2-b anchor), and
// a viewing just assigned earlier in THIS batch must count against the next pick,
// or the whole batch piles onto whoever started least-loaded. So bucket each
// agent's existing assignments by week, then walk the unassigned viewings in time
// order incrementing a running per-(agent, week) tally as we go. A viewing whose
// week has every active agent at capacity (or an empty roster, or no scheduled
// time to bucket) is left for manual routing — exactly like pickAutoAssignAgent
// refusing a full agent.

export type BulkAssignAgent = {
  id: string;
  name: string;
  tier: string | null;
  productTypes: ProductType[];
  weeklyCapacity: number | null;
  archived: boolean;
};

export type BulkAssignViewing = { id: string; scheduledAtMs: number | null };

// A pre-existing (already-assigned) viewing, used only to seed each agent's
// current per-week load before the batch runs.
export type ExistingAssignment = { agentId: string; scheduledAtMs: number | null };

export type BulkAssignPlan = {
  assignments: { showingId: string; agentId: string; agentName: string }[];
  // Viewings nobody could take this pass (every active agent at capacity for that
  // week / empty roster / no scheduled time) — left for manual routing.
  skipped: string[];
};

export function planBulkAssignments(args: {
  unassigned: readonly BulkAssignViewing[];
  existing: readonly ExistingAssignment[];
  agents: readonly BulkAssignAgent[];
  tz: string;
  weekStartsOn?: number;
}): BulkAssignPlan {
  const active = args.agents.filter((a) => !a.archived);
  const assignments: BulkAssignPlan["assignments"] = [];
  const skipped: string[] = [];
  // No roster -> nothing can be routed; every viewing falls to manual.
  if (active.length === 0) {
    for (const v of args.unassigned) skipped.push(v.id);
    return { assignments, skipped };
  }

  const weekStartsOn = args.weekStartsOn ?? 0;
  const weekStartOf = (ms: number): number =>
    orgWeekWindow(ms, args.tz, weekStartsOn).startMs;
  const loadKey = (agentId: string, weekStartMs: number): string =>
    `${agentId}|${weekStartMs}`;

  // Seed each agent's current per-(agent, week) load from their existing
  // assignments. A row with no time can't be placed in a week and carries no load.
  const load = new Map<string, number>();
  for (const e of args.existing) {
    if (e.scheduledAtMs == null) continue;
    const k = loadKey(e.agentId, weekStartOf(e.scheduledAtMs));
    load.set(k, (load.get(k) ?? 0) + 1);
  }

  // Walk the viewings in time order (soonest first; a null time sorts last and is
  // skipped) so the balancing is deterministic and front-loads the nearest ones.
  const ordered = [...args.unassigned].sort((a, b) => {
    const ta = a.scheduledAtMs ?? Number.POSITIVE_INFINITY;
    const tb = b.scheduledAtMs ?? Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });

  for (const v of ordered) {
    if (v.scheduledAtMs == null) {
      // No time -> capacity is weekly, so it can't be placed; leave for manual.
      skipped.push(v.id);
      continue;
    }
    const weekStartMs = weekStartOf(v.scheduledAtMs);
    const candidates: SuggestCandidate[] = active.map((a) => ({
      id: a.id,
      name: a.name,
      tier: a.tier,
      productTypes: a.productTypes,
      weeklyCapacity: a.weeklyCapacity,
      // Existing load for this week PLUS anything this batch already gave them.
      assignedThisWeek: load.get(loadKey(a.id, weekStartMs)) ?? 0,
      archived: false,
    }));
    const pick = pickAutoAssignAgent(candidates);
    if (!pick) {
      skipped.push(v.id);
      continue;
    }
    assignments.push({
      showingId: v.id,
      agentId: pick.agentId,
      agentName: pick.name,
    });
    const k = loadKey(pick.agentId, weekStartMs);
    load.set(k, (load.get(k) ?? 0) + 1);
  }

  return { assignments, skipped };
}
