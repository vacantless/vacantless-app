// Unit tests for the pure custom pre-screening question helpers (S291).
// Run: npx tsx scripts/test-screening-questions.ts
import {
  QUESTION_TYPES,
  isQuestionType,
  validateNewQuestion,
  parseCustomAnswer,
  buildAnswerSnapshot,
  questionTypeLabel,
  normalizeChoices,
  MAX_QUESTION_PROMPT_LEN,
  MAX_CUSTOM_ANSWER_LEN,
  MIN_CHOICES,
  MAX_CHOICES,
  MAX_CHOICE_LABEL_LEN,
  isPreferredAnswer,
  normalizePreferredAnswer,
  isPreferenceMismatch,
  collectPreferenceMismatches,
  preferredAnswerLabel,
  type ScreeningQuestion,
  type CustomAnswerSnapshot,
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
ok("type: choice valid (S294)", isQuestionType("choice"));
ok("type: junk invalid", !isQuestionType("banana"));
ok("type: non-string invalid", !isQuestionType(3 as unknown));
ok("type: list is exactly text+yesno+choice", QUESTION_TYPES.join(",") === "text,yesno,choice");

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
  const r = validateNewQuestion({ prompt: "Pick a color", qtype: "rating" });
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
  { id: "q1", prompt: "Where do you work?", qtype: "text", required: false, preferred_answer: null, choices: [] },
  { id: "q2", prompt: "Are you a non-smoker?", qtype: "yesno", required: true, preferred_answer: null, choices: [] },
  { id: "q3", prompt: "Any other notes?", qtype: "text", required: false, preferred_answer: null, choices: [] },
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
ok("label: choice", questionTypeLabel("choice") === "Multiple choice");

// ===========================================================================
// Preferred answer + soft mismatch (S293, the v2 soft flag)
// ===========================================================================

// --- isPreferredAnswer ------------------------------------------------------
ok("pref: yes valid", isPreferredAnswer("yes"));
ok("pref: no valid", isPreferredAnswer("no"));
ok("pref: maybe invalid", !isPreferredAnswer("maybe"));
ok("pref: empty invalid", !isPreferredAnswer(""));
ok("pref: null invalid", !isPreferredAnswer(null));

// --- normalizePreferredAnswer ----------------------------------------------
ok("norm pref: yesno + yes -> yes", normalizePreferredAnswer("yesno", "yes") === "yes");
ok("norm pref: yesno + NO -> no (case-insensitive)", normalizePreferredAnswer("yesno", "NO") === "no");
ok("norm pref: yesno + padded -> trimmed", normalizePreferredAnswer("yesno", "  yes ") === "yes");
ok("norm pref: yesno + bogus -> null", normalizePreferredAnswer("yesno", "sometimes") === null);
ok("norm pref: yesno + empty -> null", normalizePreferredAnswer("yesno", "") === null);
ok("norm pref: text question ALWAYS null (guard)", normalizePreferredAnswer("text", "yes") === null);
ok("norm pref: null raw -> null", normalizePreferredAnswer("yesno", null) === null);

// --- validateNewQuestion w/ preferred ---------------------------------------
{
  const r = validateNewQuestion({ prompt: "Smoker?", qtype: "yesno", preferredAnswer: "no" });
  ok("validate: yesno carries preferred", r.ok && r.values.preferredAnswer === "no");
}
{
  // a preferred answer on a TEXT question is silently dropped, not rejected
  const r = validateNewQuestion({ prompt: "Where do you work?", qtype: "text", preferredAnswer: "yes" });
  ok("validate: text drops preferred (still ok)", r.ok && r.values.preferredAnswer === null);
}
{
  const r = validateNewQuestion({ prompt: "Smoker?", qtype: "yesno" });
  ok("validate: missing preferred -> null", r.ok && r.values.preferredAnswer === null);
}
{
  const r = validateNewQuestion({ prompt: "Smoker?", qtype: "yesno", preferredAnswer: "bogus" });
  ok("validate: bogus preferred -> null (not rejected)", r.ok && r.values.preferredAnswer === null);
}

// --- buildAnswerSnapshot carries preferred ----------------------------------
{
  const qs: ScreeningQuestion[] = [
    { id: "p1", prompt: "Non-smoker?", qtype: "yesno", required: true, preferred_answer: "yes", choices: [] },
    { id: "p2", prompt: "Where do you work?", qtype: "text", required: false, preferred_answer: null, choices: [] },
    { id: "p3", prompt: "Have a car?", qtype: "yesno", required: false, preferred_answer: null, choices: [] },
  ];
  const snap = buildAnswerSnapshot(qs, { p1: "no", p2: "Acme", p3: "yes" });
  const byId = (id: string) => snap.find((s) => s.question_id === id)!;
  ok("snapshot: yesno w/ preference carries preferred", byId("p1").preferred === "yes");
  ok("snapshot: text question has no preferred key", !("preferred" in byId("p2")));
  ok("snapshot: yesno w/o preference has no preferred key", !("preferred" in byId("p3")));
}

// --- isPreferenceMismatch ---------------------------------------------------
ok(
  "mismatch: preferred yes, answered no -> mismatch",
  isPreferenceMismatch({ question_id: "x", prompt: "?", qtype: "yesno", answer: "no", preferred: "yes" }),
);
ok(
  "mismatch: preferred yes, answered yes -> no mismatch",
  !isPreferenceMismatch({ question_id: "x", prompt: "?", qtype: "yesno", answer: "yes", preferred: "yes" }),
);
ok(
  "mismatch: no preference -> never a mismatch",
  !isPreferenceMismatch({ question_id: "x", prompt: "?", qtype: "yesno", answer: "no" }),
);
ok(
  "mismatch: pre-S293 snapshot (no preferred key) -> silent",
  !isPreferenceMismatch({ question_id: "x", prompt: "?", qtype: "text", answer: "anything" } as CustomAnswerSnapshot),
);

// --- collectPreferenceMismatches --------------------------------------------
{
  const snaps: CustomAnswerSnapshot[] = [
    { question_id: "a", prompt: "Non-smoker?", qtype: "yesno", answer: "no", preferred: "yes" },
    { question_id: "b", prompt: "Have a car?", qtype: "yesno", answer: "yes", preferred: "yes" },
    { question_id: "c", prompt: "Where do you work?", qtype: "text", answer: "Acme" },
  ];
  const out = collectPreferenceMismatches(snaps);
  ok("collect: returns only the mismatch", out.length === 1 && out[0].question_id === "a");
  ok("collect: null -> empty", collectPreferenceMismatches(null).length === 0);
  ok("collect: undefined -> empty", collectPreferenceMismatches(undefined).length === 0);
}

// --- preferredAnswerLabel ---------------------------------------------------
ok("pref label: yes", preferredAnswerLabel("yes") === "Prefer Yes");
ok("pref label: no", preferredAnswerLabel("no") === "Prefer No");
ok("pref label: null", preferredAnswerLabel(null) === "No preference");

// ===========================================================================
// Choice single-select question type (S294)
// ===========================================================================

// --- normalizeChoices -------------------------------------------------------
ok("choices: string splits on newlines", normalizeChoices("a\nb\nc").join("|") === "a|b|c");
ok("choices: CRLF splits too", normalizeChoices("a\r\nb").join("|") === "a|b");
ok("choices: trims each option", normalizeChoices("  a  \n b ").join("|") === "a|b");
ok("choices: collapses inner whitespace", normalizeChoices("1   bedroom").join("|") === "1 bedroom");
ok("choices: drops blank lines", normalizeChoices("a\n\n  \nb").join("|") === "a|b");
ok("choices: dedupes (first wins, order preserved)", normalizeChoices("a\nb\na").join("|") === "a|b");
ok("choices: accepts an array input", normalizeChoices(["x", " y ", "x"]).join("|") === "x|y");
ok("choices: null -> empty", normalizeChoices(null).length === 0);
ok("choices: undefined -> empty", normalizeChoices(undefined).length === 0);
{
  const many = Array.from({ length: MAX_CHOICES + 5 }, (_, i) => `opt${i}`).join("\n");
  ok("choices: caps at MAX_CHOICES", normalizeChoices(many).length === MAX_CHOICES);
}
{
  const long = "x".repeat(MAX_CHOICE_LABEL_LEN + 20);
  ok("choices: clamps each label length", normalizeChoices(long)[0].length === MAX_CHOICE_LABEL_LEN);
}

// --- validateNewQuestion (choice) -------------------------------------------
{
  const r = validateNewQuestion({ prompt: "Unit type?", qtype: "choice", choices: "Studio\n1 bedroom\n2 bedroom" });
  ok("validate choice: ok with >=2 options", r.ok === true);
  ok("validate choice: keeps qtype", r.ok && r.values.qtype === "choice");
  ok("validate choice: normalizes choices", r.ok && r.values.choices.join("|") === "Studio|1 bedroom|2 bedroom");
  ok("validate choice: preferred always null (no soft flag)", r.ok && r.values.preferredAnswer === null);
}
{
  const r = validateNewQuestion({ prompt: "Unit?", qtype: "choice", choices: "Only one" });
  ok("validate choice: <2 options rejected", !r.ok && r.reason === "choices");
}
{
  const r = validateNewQuestion({ prompt: "Unit?", qtype: "choice", choices: "Dup\nDup" });
  ok("validate choice: dedup-to-one rejected", !r.ok && r.reason === "choices");
}
{
  const r = validateNewQuestion({ prompt: "Unit?", qtype: "choice", choices: ["A", "B"] });
  ok("validate choice: array input ok", r.ok && r.values.choices.join("|") === "A|B");
}
{
  // a preferred answer offered on a choice question is dropped (yes/no-only flag)
  const r = validateNewQuestion({ prompt: "Unit?", qtype: "choice", choices: "A\nB", preferredAnswer: "yes" });
  ok("validate choice: preferred dropped to null", r.ok && r.values.preferredAnswer === null);
}
{
  // text/yesno never carry choices even if the form sends some
  const r = validateNewQuestion({ prompt: "Where?", qtype: "text", choices: "A\nB" });
  ok("validate text: choices forced empty", r.ok && r.values.choices.length === 0);
}
ok("validate choice: MIN_CHOICES is 2", MIN_CHOICES === 2);

// --- parseCustomAnswer (choice) ---------------------------------------------
const CHOICES = ["Studio", "1 bedroom", "2 bedroom"];
ok("answer choice: exact match kept", parseCustomAnswer("choice", "1 bedroom", CHOICES) === "1 bedroom");
ok("answer choice: trims then matches", parseCustomAnswer("choice", "  Studio  ", CHOICES) === "Studio");
ok("answer choice: non-option -> null", parseCustomAnswer("choice", "Penthouse", CHOICES) === null);
ok("answer choice: empty -> null", parseCustomAnswer("choice", "", CHOICES) === null);
ok("answer choice: no choices list -> null", parseCustomAnswer("choice", "Studio") === null);
ok("answer choice: case-sensitive (does not match)", parseCustomAnswer("choice", "studio", CHOICES) === null);

// --- buildAnswerSnapshot (choice) -------------------------------------------
{
  const qs: ScreeningQuestion[] = [
    { id: "c1", prompt: "Unit type?", qtype: "choice", required: true, preferred_answer: null, choices: CHOICES },
    { id: "c2", prompt: "Floor?", qtype: "choice", required: false, preferred_answer: null, choices: ["Low", "High"] },
  ];
  const snap = buildAnswerSnapshot(qs, { c1: "2 bedroom", c2: "Penthouse" });
  ok("snapshot choice: valid option kept", snap.length === 1 && snap[0].question_id === "c1");
  ok("snapshot choice: carries the chosen option", snap[0].answer === "2 bedroom");
  ok("snapshot choice: carries qtype", snap[0].qtype === "choice");
  ok("snapshot choice: invalid option dropped (c2)", !snap.some((s) => s.question_id === "c2"));
  ok("snapshot choice: no preferred key", !("preferred" in snap[0]));
}

console.log(`\nscreening-questions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
