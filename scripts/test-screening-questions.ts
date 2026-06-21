// Unit tests for the pure custom pre-screening question helpers (S291).
// Run: npx tsx scripts/test-screening-questions.ts
import {
  QUESTION_TYPES,
  isQuestionType,
  validateNewQuestion,
  parseCustomAnswer,
  buildAnswerSnapshot,
  questionTypeLabel,
  MAX_QUESTION_PROMPT_LEN,
  MAX_CUSTOM_ANSWER_LEN,
  type ScreeningQuestion,
} from "../lib/screening-questions";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- isQuestionType ---------------------------------------------------------
ok("type: text valid", isQuestionType("text"));
ok("type: yesno valid", isQuestionType("yesno"));
ok("type: choice not (yet) valid", !isQuestionType("choice"));
ok("type: junk invalid", !isQuestionType("banana"));
ok("type: non-string invalid", !isQuestionType(3 as unknown));
ok("type: list is exactly text+yesno", QUESTION_TYPES.join(",") === "text,yesno");

// --- validateNewQuestion ----------------------------------------------------
{
  const r = validateNewQuestion({ prompt: "Where do you work?", qtype: "text" });
  ok("validate: happy text ok", r.ok === true);
  ok("validate: happy text keeps prompt", r.ok && r.values.prompt === "Where do you work?");
  ok("validate: happy text keeps qtype", r.ok && r.values.qtype === "text");
}
{
  const r = validateNewQuestion({ prompt: "  Are you a non-smoker? ", qtype: "yesno" });
  ok("validate: trims prompt", r.ok && r.values.prompt === "Are you a non-smoker?");
}
{
  const r = validateNewQuestion({ prompt: "How   many    cars?", qtype: "text" });
  ok("validate: collapses inner whitespace", r.ok && r.values.prompt === "How many cars?");
}
{
  const r = validateNewQuestion({ prompt: "   ", qtype: "text" });
  ok("validate: blank prompt rejected", !r.ok && r.reason === "prompt");
}
{
  const r = validateNewQuestion({ prompt: "x".repeat(MAX_QUESTION_PROMPT_LEN + 1), qtype: "text" });
  ok("validate: over-long prompt rejected", !r.ok && r.reason === "prompt");
}
{
  const r = validateNewQuestion({ prompt: "x".repeat(MAX_QUESTION_PROMPT_LEN), qtype: "text" });
  ok("validate: exactly-max prompt ok", r.ok === true);
}
{
  const r = validateNewQuestion({ prompt: "Pick a color", qtype: "choice" });
  ok("validate: unsupported qtype rejected", !r.ok && r.reason === "qtype");
}

// --- parseCustomAnswer: yesno ----------------------------------------------
ok("answer yesno: 'yes' -> yes", parseCustomAnswer("yesno", "yes") === "yes");
ok("answer yesno: 'Yes' -> yes", parseCustomAnswer("yesno", "Yes") === "yes");
ok("answer yesno: ' NO ' -> no", parseCustomAnswer("yesno", " NO ") === "no");
ok("answer yesno: 'maybe' -> null", parseCustomAnswer("yesno", "maybe") === null);
ok("answer yesno: '' -> null", parseCustomAnswer("yesno", "") === null);
ok("answer yesno: null -> null", parseCustomAnswer("yesno", null) === null);
ok("answer yesno: '1' -> null (not a yes/no token)", parseCustomAnswer("yesno", "1") === null);

// --- parseCustomAnswer: text ------------------------------------------------
ok("answer text: trims", parseCustomAnswer("text", "  Acme Corp  ") === "Acme Corp");
ok("answer text: blank -> null", parseCustomAnswer("text", "   ") === null);
ok("answer text: null -> null", parseCustomAnswer("text", null) === null);
{
  const long = "a".repeat(MAX_CUSTOM_ANSWER_LEN + 50);
  const got = parseCustomAnswer("text", long);
  ok("answer text: clamps to max len", got?.length === MAX_CUSTOM_ANSWER_LEN);
}
ok("answer text: keeps interior punctuation", parseCustomAnswer("text", "I work at A & B, Inc.") === "I work at A & B, Inc.");

// --- buildAnswerSnapshot ----------------------------------------------------
const QS: ScreeningQuestion[] = [
  { id: "q1", prompt: "Where do you work?", qtype: "text", required: false },
  { id: "q2", prompt: "Are you a non-smoker?", qtype: "yesno", required: true },
  { id: "q3", prompt: "Any other notes?", qtype: "text", required: false },
];

{
  const snap = buildAnswerSnapshot(QS, { q1: "Acme", q2: "yes", q3: "  " });
  ok("snapshot: drops the empty text answer (q3)", snap.length === 2);
  ok("snapshot: preserves question order", snap[0].question_id === "q1" && snap[1].question_id === "q2");
  ok("snapshot: carries the prompt (q1)", snap[0].prompt === "Where do you work?");
  ok("snapshot: carries normalized text answer", snap[0].answer === "Acme");
  ok("snapshot: carries normalized yesno answer", snap[1].answer === "yes");
  ok("snapshot: carries qtype", snap[1].qtype === "yesno");
}
{
  // an invalid yesno value is dropped entirely (not stored as a bogus answer)
  const snap = buildAnswerSnapshot(QS, { q2: "sometimes" });
  ok("snapshot: invalid yesno dropped", snap.length === 0);
}
{
  // an answer for an id NOT in the question set is ignored
  const snap = buildAnswerSnapshot(QS, { q1: "Acme", qZZ: "ghost" });
  ok("snapshot: stray id ignored", snap.length === 1 && snap[0].question_id === "q1");
}
{
  const snap = buildAnswerSnapshot([], { q1: "x" });
  ok("snapshot: no questions -> empty", snap.length === 0);
}
{
  const snap = buildAnswerSnapshot(QS, {});
  ok("snapshot: no answers -> empty", snap.length === 0);
}

// --- questionTypeLabel ------------------------------------------------------
ok("label: text", questionTypeLabel("text") === "Short text");
ok("label: yesno", questionTypeLabel("yesno") === "Yes / no");

console.log(`\nscreening-questions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
