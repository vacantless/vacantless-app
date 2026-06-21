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
};

// --- the per-lead answer snapshot (one element of leads.screen_custom_answers)
export type CustomAnswerSnapshot = {
  question_id: string;
  prompt: string;
  qtype: QuestionType;
  answer: string;
};

// --- validating a new/edited question (operator side) -----------------------
export type NewQuestionInput = { prompt: string; qtype: string };
export type ValidateQuestionResult =
  | { ok: true; values: { prompt: string; qtype: QuestionType } }
  | { ok: false; reason: "prompt" | "qtype" };

/**
 * Trim + validate an operator-authored question. Prompt must be 1..200 chars
 * after trimming; qtype must be one of QUESTION_TYPES. Whitespace inside the
 * prompt is collapsed so a label never renders with odd runs of spaces.
 */
export function validateNewQuestion(input: NewQuestionInput): ValidateQuestionResult {
  const prompt = String(input.prompt ?? "").replace(/\s+/g, " ").trim();
  if (prompt.length === 0 || prompt.length > MAX_QUESTION_PROMPT_LEN) {
    return { ok: false, reason: "prompt" };
  }
  if (!isQuestionType(input.qtype)) {
    return { ok: false, reason: "qtype" };
  }
  return { ok: true, values: { prompt, qtype: input.qtype } };
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
    out.push({ question_id: q.id, prompt: q.prompt, qtype: q.qtype, answer });
  }
  return out;
}

/** Human label for a question type (operator UI). */
export function questionTypeLabel(qtype: QuestionType): string {
  return qtype === "yesno" ? "Yes / no" : "Short text";
}
