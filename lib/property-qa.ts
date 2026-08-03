export type PropertyQaSource = "operator" | "auto";

export type PropertyQaEntry = {
  id: string;
  organizationId: string;
  propertyId: string | null;
  questionKey: string;
  questionText: string;
  answerText: string;
  source: PropertyQaSource;
  createdAt: string | null;
  updatedAt: string | null;
};

export type PropertyQaUpsertInput = {
  organizationId: string;
  propertyId: string | null;
  questionText: string;
  answerText: string;
  source?: PropertyQaSource;
};

export type PropertyQaUpsert = {
  organization_id: string;
  property_id: string | null;
  question_key: string;
  question_text: string;
  answer_text: string;
  source: PropertyQaSource;
  updated_at: string;
};

type PropertyQaClient = {
  from: (table: string) => any;
};

type PropertyQaRow = {
  id: string;
  organization_id: string;
  property_id: string | null;
  question_key: string;
  question_text: string;
  answer_text: string;
  source: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const NULL_UUID = "00000000-0000-0000-0000-000000000000";

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "come",
  "comes",
  "could",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "hello",
  "hi",
  "i",
  "in",
  "include",
  "included",
  "is",
  "it",
  "its",
  "listing",
  "me",
  "my",
  "of",
  "on",
  "please",
  "property",
  "rental",
  "that",
  "the",
  "there",
  "this",
  "to",
  "unit",
  "us",
  "we",
  "what",
  "with",
  "would",
  "you",
]);

function cleanText(value: string | null | undefined, maxLen: number): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen)
    .trim();
}

function normalizeToken(token: string): string {
  if (token === "spaces") return "space";
  if (token === "spots") return "spot";
  if (token === "dogs") return "dog";
  if (token === "cats") return "cat";
  if (token === "pets") return "pet";
  if (token === "utilities") return "utility";
  if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function keyTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => normalizeToken(token.trim()))
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export function normalizeQuestionKey(text: string): string {
  const tokens = Array.from(new Set(keyTokens(text))).sort();
  return tokens.slice(0, 12).join("-");
}

function rowToEntry(row: PropertyQaRow): PropertyQaEntry {
  return {
    id: row.id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    questionKey: row.question_key,
    questionText: row.question_text,
    answerText: row.answer_text,
    source: row.source === "auto" ? "auto" : "operator",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sortKnowledge(entries: PropertyQaEntry[]): PropertyQaEntry[] {
  return [...entries].sort((a, b) => {
    if (a.propertyId && !b.propertyId) return -1;
    if (!a.propertyId && b.propertyId) return 1;
    return a.questionText.localeCompare(b.questionText);
  });
}

export async function loadPropertyKnowledge(
  client: PropertyQaClient,
  organizationId: string,
  propertyId: string | null,
): Promise<PropertyQaEntry[]> {
  if (!organizationId) return [];

  let query = client
    .from("property_qa")
    .select(
      "id, organization_id, property_id, question_key, question_text, answer_text, source, created_at, updated_at",
    )
    .eq("organization_id", organizationId);

  query = propertyId
    ? query.or(`property_id.eq.${propertyId},property_id.is.null`)
    : query.is("property_id", null);

  const { data, error } = await query.order("question_text", {
    ascending: true,
  });
  if (error || !Array.isArray(data)) return [];
  return sortKnowledge((data as PropertyQaRow[]).map(rowToEntry));
}

function scoreEntry(
  inquiryTokens: Set<string>,
  entry: PropertyQaEntry,
): number {
  const entryTokens = entry.questionKey
    .split("-")
    .map((token) => token.trim())
    .filter(Boolean);
  if (entryTokens.length === 0 || inquiryTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of entryTokens) {
    if (inquiryTokens.has(token)) overlap++;
  }
  if (overlap === 0) return 0;
  return overlap / entryTokens.length;
}

function bestConfidentMatch(
  inquiryTokens: Set<string>,
  entries: PropertyQaEntry[],
): PropertyQaEntry | null {
  let best: { entry: PropertyQaEntry; score: number } | null = null;
  for (const entry of entries) {
    const score = scoreEntry(inquiryTokens, entry);
    if (score < 0.5) continue;
    if (!best || score > best.score) best = { entry, score };
  }
  return best?.entry ?? null;
}

export function matchKnowledge(
  inquiryText: string | null | undefined,
  entries: readonly PropertyQaEntry[] | null | undefined,
): PropertyQaEntry | null {
  const inquiryKey = normalizeQuestionKey(String(inquiryText ?? ""));
  const inquiryTokens = new Set(inquiryKey.split("-").filter(Boolean));
  if (inquiryTokens.size === 0 || !entries || entries.length === 0) return null;

  const propertyEntries = entries.filter((entry) => entry.propertyId != null);
  const propertyMatch = bestConfidentMatch(inquiryTokens, propertyEntries);
  if (propertyMatch) return propertyMatch;

  return bestConfidentMatch(
    inquiryTokens,
    entries.filter((entry) => entry.propertyId == null),
  );
}

export function buildQaUpsert(
  input: PropertyQaUpsertInput,
): PropertyQaUpsert | null {
  const questionText = cleanText(input.questionText, 240);
  const answerText = cleanText(input.answerText, 1200);
  const questionKey = normalizeQuestionKey(questionText);
  if (!input.organizationId || !questionText || !answerText || !questionKey) {
    return null;
  }
  return {
    organization_id: input.organizationId,
    property_id: input.propertyId || null,
    question_key: questionKey,
    question_text: questionText,
    answer_text: answerText,
    source: input.source === "auto" ? "auto" : "operator",
    updated_at: new Date().toISOString(),
  };
}

function scopedByProperty(query: any, propertyId: string | null) {
  return propertyId ? query.eq("property_id", propertyId) : query.is("property_id", null);
}

export async function savePropertyQaEntry(
  client: PropertyQaClient,
  input: PropertyQaUpsertInput,
): Promise<boolean> {
  const row = buildQaUpsert(input);
  if (!row) return false;

  const existingQuery = client
    .from("property_qa")
    .select("id")
    .eq("organization_id", row.organization_id)
    .eq("question_key", row.question_key);
  const { data: existing } = await scopedByProperty(
    existingQuery,
    row.property_id,
  ).maybeSingle();

  if ((existing as { id?: string } | null)?.id) {
    const { error } = await client
      .from("property_qa")
      .update({
        question_text: row.question_text,
        answer_text: row.answer_text,
        source: row.source,
        updated_at: row.updated_at,
      })
      .eq("id", (existing as { id: string }).id)
      .eq("organization_id", row.organization_id);
    return !error;
  }

  const { error } = await client.from("property_qa").insert(row);
  if (!error) return true;

  // Race-safe fallback: the expression unique index may have accepted a sibling
  // insert after our read. Update the now-existing scoped row.
  const retryQuery = client
    .from("property_qa")
    .update({
      question_text: row.question_text,
      answer_text: row.answer_text,
      source: row.source,
      updated_at: row.updated_at,
    })
    .eq("organization_id", row.organization_id)
    .eq("question_key", row.question_key);
  const { error: retryError } = await scopedByProperty(
    retryQuery,
    row.property_id,
  );
  return !retryError;
}

export { NULL_UUID as PROPERTY_QA_NULL_SCOPE_UUID };
