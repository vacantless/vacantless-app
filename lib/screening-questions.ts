// ============================================================================
// Custom pre-screening questions (S291).
//
// Beyond the three built-in qualifying questions in lib/screening.ts (income /
// move-in / pets), an operator can author arbitrary questions that render on the
// public inquiry form. v1 is INFORMATIONAL ONLY: the renter's answers are
// captured and shown to the operator on the lead, but a custom answer NEVER
// drives the auto qualify-out flag. (Same fair-housing posture as occupant count
// in lib/screening.ts: an operator-defined "preferred answer" soft flag is a
// deliberate, separate follow-on, not v1.)
//
// This module is PURE (no DOM/env/IO) so the exact normalization can run
// client-side and be unit-tested, AND so it mirrors the snapshot built inside
// the submit_public_lead RPC byte-for-byte (the anon-RPC-re-validate rule). The
// authoritative snapshot is the one the RPC writes; this module pins both sides.
// ============================================================================

export const QUESTION_TYPES = ["text", "yesno"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

// --- preferred answer (S293, the v2 soft flag) ------------------------------
// An operator may OPTIONALLY mark a "preferred answer" on a YES/NO question. If
// a renter's answer does not match, the lead shows a soft, clearly informational
// "heads-up" note. It is intentionally MORE timid than the built-in qualify-out:
//   - it ONLY applies to yes/no questions,
//   - it is NULLABLE (no preference is the default),
//   - it NEVER sets leads.qualified_out and NEVER hides/filters a lead.
// This keeps the fair-housing posture from lib/screening.ts: an arbitrary
// operator-authored question can never drive the auto qualify-out flag. The
// guard here is architectural (informational-only) + advisory (the operator UI
// disclaims protected-grounds use), NOT a prompt keyword blocklist (which would
// give false confidence and is trivially bypassed).
export const PREFERRED_ANSWERS = ["yes", "no"] as const;
export type PreferredAnswer = (typeof PREFERRED_ANSWERS)[number];

export function isPreferredAnswer(v: unknown): v is PreferredAnswer {
  return typeof v === "string" && (PREFERRED_ANSWERS as readonly string[]).includes(v);
}

/**
 * Normalize a raw preferred-answer input from the operator form. A preferred
 * answer is only meaningful on a yes/no question; for any other type, or for an
 * empty / unrecognized value, it resolves to null ("no preference"). Mirrors the
 * SQL guard in submit_public_lead / addScreeningQuestion (preferred_answer is
 * stored only when qtype = 'yesno').
 */
export function normalizePreferredAnswer(
  qtype: QuestionType,
  raw: string | null | undefined,
): PreferredAnswer | null {
  if (qtype !== "yesno") return null;
  const s = String(raw ?? "").trim().toLowerCase();
  return isPreferredAnswer(s) ? s : null;
}

/** A trimmed prompt longer than this is rejected (it renders as a form label). */
export const MAX_QUESTION_PROMPT_LEN = 200;
/** A renter answer is clamped to this many characters before storage. */
export const MAX_CUSTOM_ANSWER_LEN = 500;

export function isQuestionType(v: unknown): v is QuestionType {
  return typeof v === "string" && (QUESTION_TYPES as readonly string[]).includes(v);
}

// --- the stored question definition (org_screening_questions row) -----------
export type ScreeningQuestion = {
  id: string;
  prompt: string;
  qtype: QuestionType;
  required: boolean;
  /** Operator's preferred yes/no answer (S293). null = no preference. */
  preferred_answer: PreferredAnswer | null;
};

// --- the per-lead answer snapshot (one element of leads.screen_custom_answers)
export type CustomAnswerSnapshot = {
  question_id: string;
  prompt: string;
  qtype: QuestionType;
  answer: string;
  /**
   * The operator's preferred answer AT INTAKE (S293), snapshotted alongside the
   * answer so changing/removing the preference later never rewrites the meaning
   * of a filed lead. Optional + nullable: absent or null = no preference was set
   * (the common case + every pre-S293 lead).
   */
  preferred?: PreferredAnswer | null;
};

// --- validating a new/edited question (operator side) -----------------------
export type NewQuestionInput = {
  prompt: string;
  qtype: string;
  /** Optional operator preferred answer (S293); only honored for yes/no. */
  preferredAnswer?: string | null;
};
export type ValidateQuestionResult =
  | {
      ok: true;
      values: {
        prompt: string;
        qtype: QuestionType;
        preferredAnswer: PreferredAnswer | null;
      };
    }
  | { ok: false; reason: "prompt" | "qtype" };

/**
 * Trim + validate an operator-authored question. Prompt must be 1..200 chars
 * after trimming; qtype must be one of QUESTION_TYPES. Whitespace inside the
 * prompt is collapsed so a label never renders with odd runs of spaces. The
 * optional preferred answer (S293) is normalized to null unless the question is
 * yes/no and the value is "yes"/"no" — an invalid preference never blocks the
 * save, it just resolves to "no preference".
 */
export function validateNewQuestion(input: NewQuestionInput): ValidateQuestionResult {
  const prompt = String(input.prompt ?? "").replace(/\s+/g, " ").trim();
  if (prompt.length === 0 || prompt.length > MAX_QUESTION_PROMPT_LEN) {
    return { ok: false, reason: "prompt" };
  }
  if (!isQuestionType(input.qtype)) {
    return { ok: false, reason: "qtype" };
  }
  const preferredAnswer = normalizePreferredAnswer(input.qtype, input.preferredAnswer);
  return { ok: true, values: { prompt, qtype: input.qtype, preferredAnswer } };
}

/**
 * Normalize one renter answer by question type, returning null when there is no
 * usable answer (so the snapshot omits it). MUST match the SQL in
 * submit_public_lead (0051):
 *   - yesno: 'yes' / 'no' (case-insensitive), anything else -> null
 *   - text:  trimmed, clamped to 500 chars; empty -> null
 */
export function parseCustomAnswer(
  qtype: QuestionType,
  raw: string | null | undefined,
): string | null {
  const s = String(raw ?? "").trim();
  if (qtype === "yesno") {
    const low = s.toLowerCase();
    return low === "yes" ? "yes" : low === "no" ? "no" : null;
  }
  // text
  if (s.length === 0) return null;
  return s.slice(0, MAX_CUSTOM_ANSWER_LEN);
}

/**
 * Build the answer snapshot from the org's ACTIVE questions and the raw answers
 * keyed by question id. Preserves the question order, drops any question with no
 * usable answer. This is the exact array shape the RPC writes to
 * leads.screen_custom_answers — kept in lockstep with the SQL.
 */
export function buildAnswerSnapshot(
  questions: ScreeningQuestion[],
  rawAnswersById: Record<string, string | null | undefined>,
): CustomAnswerSnapshot[] {
  const out: CustomAnswerSnapshot[] = [];
  for (const q of questions) {
    const answer = parseCustomAnswer(q.qtype, rawAnswersById[q.id]);
    if (answer == null) continue;
    const snap: CustomAnswerSnapshot = {
      question_id: q.id,
      prompt: q.prompt,
      qtype: q.qtype,
      answer,
    };
    // Snapshot the preferred answer only when one is genuinely set (yes/no +
    // not null), so a snapshot for a no-preference question stays {…} with no
    // `preferred` key — byte-identical to the pre-S293 shape.
    const pref = normalizePreferredAnswer(q.qtype, q.preferred_answer);
    if (pref != null) snap.preferred = pref;
    out.push(snap);
  }
  return out;
}

/**
 * True when this answer has a preference set AND the renter's answer does not
 * match it (S293). Used to render the soft "heads-up" on the lead. Returns false
 * whenever no preference was snapshotted — so every pre-S293 lead, and every
 * no-preference question, is silent. This is the ONLY place the mismatch is
 * decided; it is purely informational and never feeds qualified_out.
 */
export function isPreferenceMismatch(snap: CustomAnswerSnapshot): boolean {
  return (
    snap.qtype === "yesno" &&
    snap.preferred != null &&
    snap.answer !== snap.preferred
  );
}

/** The subset of an answer snapshot that mismatches the operator's preference. */
export function collectPreferenceMismatches(
  snapshots: CustomAnswerSnapshot[] | null | undefined,
): CustomAnswerSnapshot[] {
  return (snapshots ?? []).filter(isPreferenceMismatch);
}

/** Human label for a question type (operator UI). */
export function questionTypeLabel(qtype: QuestionType): string {
  return qtype === "yesno" ? "Yes / no" : "Short text";
}

/** Human label for a preferred answer (operator UI). null = no preference. */
export function preferredAnswerLabel(pref: PreferredAnswer | null): string {
  return pref === "yes" ? "Prefer Yes" : pref === "no" ? "Prefer No" : "No preference";
}
