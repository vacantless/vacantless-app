// The word contract (ROADMAP-S693 section 2) as data, plus the pure checkers
// the plain-language gate runs. Nothing here touches the filesystem, so the
// rules can be asserted against fixed strings in scripts/test-plain-language.ts.
//
// This module is the ONE source of truth for the contract. lib/i18n/plain-words.md
// is generated from it by plainWordsMarkdown(); the gate fails when the two drift.
//
// Naming note (ROADMAP section 11): the contract is for humans. Database columns,
// enums and listing_posts.status values keep their names and are never scanned.

export type PlainWordRow = {
  /** The thing a landlord is looking at. */
  thing: string;
  /** The one English word for it. */
  en: string;
  /** The one French word for it. */
  fr: string;
  /** Words that mean the same thing and must not ship. */
  banned: string[];
};

export const PLAIN_WORDS: PlainWordRow[] = [
  {
    thing: "The record for the unit",
    en: "your listing",
    fr: "votre annonce",
    banned: [
      "the one listing",
      "one listing",
      "listing facts",
      "unit details",
      "listing details",
      "property details",
      "packet",
    ],
  },
  {
    thing: "The action of putting it on websites",
    en: "Post",
    fr: "Publier",
    banned: [
      "publish",
      "republish",
      "re-publish",
      "launch",
      "send live",
      "sent live",
      "send it live",
      "set live",
      "set it live",
      "get online",
      "dispatch",
      "sync",
      "one-tap",
      "1-tap",
      "tap publish",
      "start",
      "go live",
      "blast",
    ],
  },
  {
    thing: "The websites",
    en: "rental sites",
    fr: "sites de location",
    banned: [
      "portals",
      "destinations",
      "channels",
      "outside sites",
      "outside ads",
      "outside-site",
      "feed",
      "feed partner",
      "feed candidate",
      "partner route",
      "lane",
      "network",
    ],
  },
  {
    thing: "One website",
    en: "site",
    fr: "site",
    banned: ["portal", "channel", "destination"],
  },
  {
    thing: "The link to the ad on a site",
    en: "the link to your ad",
    fr: "le lien de votre annonce",
    banned: [
      "proof",
      "live proof",
      "live-ad proof",
      "posting proof",
      "ad URL",
      "live URL",
      "external URL",
      "destination URL",
      "tracker",
    ],
  },
  {
    thing: "The page Vacantless hosts",
    en: "your Vacantless page",
    fr: "votre page Vacantless",
    banned: ["renter page", "public page", "/r page", "share link", "tracked link"],
  },
  {
    thing: "The link renters click to ask",
    en: "your inquiry link",
    fr: "votre lien de contact",
    banned: ["tracked inquiry link", "attribution"],
  },
  {
    thing: "A renter who wrote in",
    en: "inquiry",
    fr: "demande",
    banned: ["lead", "attributed lead", "outside-site inquiry"],
  },
  {
    thing: "Log in on the site",
    en: "sign in",
    fr: "se connecter",
    banned: [
      "login",
      "log in",
      "session",
      "saved session",
      "reconnect",
      "authorize",
      "authorization",
      "authorized",
      "connect once",
      "record your account",
      "session check",
    ],
  },
  {
    thing: "Money the site charges",
    en: "the site's fee",
    fr: "les frais du site",
    banned: [
      "paid placement",
      "pass-through spend",
      "spend limit",
      "spend authorization",
      "top-up",
      "plan",
      "concierge",
      "done-for-you",
    ],
  },
  {
    thing: "We do it for you",
    en: "we post it for you",
    fr: "nous publions pour vous",
    banned: [
      "autopilot",
      "worker",
      "automation",
      "automate",
      "automatically",
      "headless",
      "autofire",
      "hands-off",
      "network agent",
      "posting assist",
      "managed posting",
      "Managed",
    ],
  },
  {
    thing: "Rented",
    en: "rented",
    fr: "loue",
    banned: ["leased", "lease-up", "tenancy"],
  },
  {
    thing: "Ad no longer on the site",
    en: "taken down",
    fr: "retiree",
    banned: ["removed", "removing", "expired", "off-market", "retired"],
  },
  {
    thing: "Site state (only three)",
    en: "Ready / Needs you / Not yet",
    fr: "Pret / A vous / Pas encore",
    banned: [
      "already linked",
      "not linked yet",
      "not available yet",
      "connected, not authorized",
      "free cap reached",
      "you post it yourself",
      "ready to automate",
      "waiting on setup",
      "refresh due",
      "submitted not live",
    ],
  },
];

/** Uppercase tokens that are names, not shouting. */
export const ACRONYM_ALLOWLIST = [
  "MLS",
  "PDF",
  "URL",
  "CSV",
  "AC",
  "ID",
  "FAQ",
  "SMS",
  "QR",
  "CTA",
  "OK",
  "AI",
  "TV",
  "US",
  "CA",
  "ON",
  "GTA",
  "CAD",
  "API",
  "PNG",
  "JPG",
  "JPEG",
  "GIF",
  "SVG",
  "MB",
  "KB",
  "GB",
  "XML",
  "RSS",
  "CSS",
  "HTML",
];

/**
 * Phrases where a banned word is not the banned MEANING. "Getting started" is a
 * section name, not the action word; "leading photo" is the first photo, not a
 * renter inquiry. Removed before ban matching, never before the other rules.
 */
export const EXEMPT_PHRASES = [
  "getting started",
  "leading photo",
  "leading image",
  "get started",
];

export const MAX_SENTENCE_WORDS = 14;
export const TARGET_SENTENCE_WORDS = 12;

export type PlainLanguageRule =
  | "banned_word"
  | "sentence_length"
  | "all_caps"
  | "em_dash"
  | "ampersand_or_slash"
  | "parentheses"
  | "negative_promise"
  | "fr_missing_key"
  | "fr_empty"
  | "fr_extra_key";

export const PLAIN_LANGUAGE_RULES: PlainLanguageRule[] = [
  "banned_word",
  "sentence_length",
  "all_caps",
  "em_dash",
  "ampersand_or_slash",
  "parentheses",
  "negative_promise",
  "fr_missing_key",
  "fr_empty",
  "fr_extra_key",
];

export type PlainLanguageFinding = {
  rule: PlainLanguageRule;
  /** The exact string that failed. Findings are matched to the baseline by rule + text. */
  text: string;
  /** What to change, in one line. */
  detail: string;
};

/**
 * Replace every balanced brace group with a single word, so an ICU message
 * ("{count, plural, one {# left} other {# left}}") counts as one word and does
 * not trip the sentence rules. Banned words are matched on the RAW string, so
 * a banned word inside a plural branch is still caught.
 */
export function stripIcu(text: string): string {
  let out = "";
  let depth = 0;
  for (const ch of text) {
    if (ch === "{") {
      if (depth === 0) out += "value";
      depth++;
      continue;
    }
    if (ch === "}") {
      if (depth > 0) depth--;
      continue;
    }
    if (depth === 0) out += ch;
  }
  // An unbalanced brace would otherwise swallow the rest of the string and blind
  // every structural rule, so fall back to the raw text with the braces removed.
  if (depth !== 0) return text.replace(/[{}]/g, " ");
  return out;
}

/** Words whose trailing dot is not a full stop. */
const ABBREVIATIONS = new Set([
  "dr", "mr", "mrs", "ms", "st", "ave", "rd", "inc", "ltd", "apt",
  "vs", "etc", "eg", "ie", "approx", "dept", "est", "jan", "feb", "mar",
  "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
  "no",
]);

export function splitSentences(text: string): string[] {
  const normalized = stripIcu(text).replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    current += ch;
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    const prev = normalized[i - 1] ?? "";
    const next = normalized[i + 1] ?? "";
    // A period between digits is a decimal, not a full stop.
    if (ch === "." && /[0-9]/.test(prev) && /[0-9]/.test(next)) continue;
    // "e.g.", "Dr.", "Sep." are not full stops either. Without this a long
    // sentence containing one is split into two short ones and escapes the
    // sentence-length rule.
    if (ch === ".") {
      const match = /([A-Za-zÀ-ÿ.]+)$/.exec(current.slice(0, -1));
      const word = match ? match[1].replace(/\./g, "") : "";
      const afterSpace = next === " " ? normalized[i + 2] ?? "" : "";
      const abbreviation =
        (word.length > 0 && ABBREVIATIONS.has(word.toLowerCase())) ||
        word.length === 1 ||
        (word.length === 2 && /[a-zà-ÿ0-9]/.test(afterSpace));
      if (abbreviation) continue;
    }
    // Swallow a run of terminators so an ellipsis stays one break.
    while (/[.!?]/.test(normalized[i + 1] ?? "")) {
      i++;
      current += normalized[i];
    }
    const after = normalized[i + 1] ?? "";
    if (after === " " || after === "") {
      parts.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter((s) => /[A-Za-zÀ-ÿ]/.test(s));
}

export function countWords(sentence: string): number {
  return sentence
    .split(/\s+/)
    .filter((t) => /[A-Za-z0-9À-ÿ]/.test(t)).length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every English form of a one word ban: publish, publishes, published, publishing. */
export function inflect(word: string): string[] {
  const forms = new Set([word, `${word}s`, `${word}es`, `${word}d`, `${word}ed`, `${word}ing`]);
  if (word.endsWith("e")) {
    const stem = word.slice(0, -1);
    forms.add(`${stem}ing`);
    forms.add(`${stem}ed`);
  }
  if (word.endsWith("y")) {
    const stem = word.slice(0, -1);
    forms.add(`${stem}ies`);
    forms.add(`${stem}ied`);
  }
  return [...forms];
}

type CompiledBan = { phrase: string; en: string; re: RegExp };

let compiledBans: CompiledBan[] | null = null;

function bans(): CompiledBan[] {
  if (compiledBans) return compiledBans;
  const out: CompiledBan[] = [];
  for (const row of PLAIN_WORDS) {
    for (const phrase of row.banned) {
      const oneWord = !/\s/.test(phrase);
      // A verb ships inflected far more often than pluralised: "Published",
      // "Launching", "Automating". A flat suffix group cannot spell those:
      // "automate" + "ing" is not "automating". Build the real forms instead.
      const forms = oneWord ? inflect(phrase) : [phrase, `${phrase}s`, `${phrase}es`];
      const body =
        forms.length === 1
          ? escapeRegExp(forms[0]).replace(/\s+/g, "\\s+")
          : `(?:${forms
              .map((f) => escapeRegExp(f).replace(/\s+/g, "\\s+"))
              .sort((a, b) => b.length - a.length)
              .join("|")})`;
      // A ban that already contains a hyphen must not match inside a longer
      // hyphenated word. A plain word MUST match inside one, or "portal-level"
      // is a free pass around the whole contract.
      const hyphenated = phrase.includes("-");
      const left = hyphenated ? "(?<![\\w-])" : "(?<!\\w)";
      const right = hyphenated ? "(?![\\w-])" : "(?!\\w)";
      out.push({ phrase, en: row.en, re: new RegExp(`${left}${body}${right}`, "i") });
    }
  }
  compiledBans = out;
  return out;
}

function capsWords(sentence: string): string[] {
  return stripIcu(sentence)
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((t) => t.length > 0);
}

/** Unicode aware, because WP7 writes the whole control room in French. */
function isShoutedWord(token: string): boolean {
  if (!/^\p{Lu}[\p{Lu}\p{N}'’.-]*$/u.test(token)) return false;
  return token.replace(/[^\p{L}]/gu, "").length >= 2;
}

function isAllowedAcronym(token: string): boolean {
  return ACRONYM_ALLOWLIST.includes(token.replace(/[^\p{L}]/gu, "").toUpperCase());
}

const NEGATIVE_PROMISE_PATTERNS: { re: RegExp; detail: string }[] = [
  { re: /^\s*nothing\b/i, detail: 'starts with "Nothing"' },
  { re: /\bnever (?:see|sees|store|stores|sign|signs|shares?)\b/i, detail: "promises what we never do" },
  { re: /\bis not (?:posted|charged|treated)\b/i, detail: "explains what does not happen" },
  { re: /\bnot (?:posted|charged) (?:until|without)\b/i, detail: "explains what does not happen" },
  { re: /\bwithout (?:approval|your approval)\b/i, detail: "explains what does not happen" },
  { re: /\bwe never\b/i, detail: "explains what does not happen" },
];

/**
 * Every rule that can be judged from one string on its own. The catalog-parity
 * rules (fr_missing_key, fr_empty, fr_extra_key) compare two files and live in
 * the gate script.
 */
export function checkPlainLanguage(text: string): PlainLanguageFinding[] {
  const findings: PlainLanguageFinding[] = [];
  const trimmed = text.trim();
  if (!trimmed) return findings;

  let forBans = trimmed;
  for (const phrase of EXEMPT_PHRASES) {
    forBans = forBans.replace(new RegExp(escapeRegExp(phrase).replace(/\s+/g, "\\s+"), "gi"), " ");
  }
  for (const ban of bans()) {
    if (ban.re.test(forBans)) {
      findings.push({
        rule: "banned_word",
        text: trimmed,
        detail: `banned word "${ban.phrase}"; say "${ban.en}"`,
      });
    }
  }

  const sentences = splitSentences(trimmed);
  for (const sentence of sentences) {
    const words = countWords(sentence);
    if (words > MAX_SENTENCE_WORDS) {
      findings.push({
        rule: "sentence_length",
        text: trimmed,
        detail: `${words} words in one sentence (gate ${MAX_SENTENCE_WORDS}, target ${TARGET_SENTENCE_WORDS}): "${sentence}"`,
      });
    }
  }

  // Section 2 is "no ALL CAPS anywhere", so one shouted word is enough. Names
  // that are genuinely upper case live in ACRONYM_ALLOWLIST.
  const shouted = capsWords(trimmed).filter((t) => isShoutedWord(t) && !isAllowedAcronym(t));
  if (shouted.length) {
    findings.push({
      rule: "all_caps",
      text: trimmed,
      detail: `upper case: ${shouted.join(" ")}; write it in sentence case`,
    });
  }

  // "--" is a dash used as punctuation, but "var(--brand-color)" is a CSS
  // custom property, so a "--" straight after "(" does not count.
  if (/[—–]/.test(trimmed) || /(?<!\()--/.test(trimmed)) {
    findings.push({
      rule: "em_dash",
      text: trimmed,
      detail: "no dashes as punctuation (standing rule); use a full stop",
    });
  }

  if (/&/.test(trimmed)) {
    findings.push({
      rule: "ampersand_or_slash",
      text: trimmed,
      detail: 'no "&" in landlord copy; write "and"',
    });
  } else if (/[A-Za-z]\s*\/\s*[A-Za-z]|[0-9]\/[A-Za-z]/.test(trimmed)) {
    findings.push({
      rule: "ampersand_or_slash",
      text: trimmed,
      detail: 'no "/" inside a sentence; pick one word',
    });
  }

  if (/[()]/.test(stripIcu(trimmed))) {
    findings.push({
      rule: "parentheses",
      text: trimmed,
      detail: "no parentheses in landlord copy; make it its own sentence or drop it",
    });
  }

  for (const sentence of sentences.length ? sentences : [trimmed]) {
    for (const pattern of NEGATIVE_PROMISE_PATTERNS) {
      if (pattern.re.test(sentence)) {
        findings.push({
          rule: "negative_promise",
          text: trimmed,
          detail: `${pattern.detail}; say what happens instead`,
        });
        break;
      }
    }
  }

  return findings;
}

/** The section 2 table, generated. lib/i18n/plain-words.md must match this byte for byte. */
export function plainWordsMarkdown(): string {
  const lines: string[] = [];
  lines.push("# The word contract");
  lines.push("");
  lines.push(
    "Generated from `lib/i18n/plain-words.ts`. Do not edit this file by hand: change the",
  );
  lines.push(
    "TypeScript table and run `npm run test:plain-language -- --regenerate-doc`.",
  );
  lines.push("");
  lines.push(
    "One word per thing, everywhere, English and French. Source: ROADMAP-S693 section 2.",
  );
  lines.push("");
  lines.push("| Thing | English word | French word | Banned (delete on sight) |");
  lines.push("|---|---|---|---|");
  for (const row of PLAIN_WORDS) {
    lines.push(`| ${row.thing} | ${row.en} | ${row.fr} | ${row.banned.join(", ")} |`);
  }
  lines.push("");
  lines.push("## Sentence rules");
  lines.push("");
  lines.push(
    `- ${TARGET_SENTENCE_WORDS} words or fewer per sentence. The gate fails at ${MAX_SENTENCE_WORDS}.`,
  );
  lines.push("- One idea per sentence. Buttons are 1 to 3 words.");
  lines.push("- No upper case words. No dashes as punctuation.");
  lines.push('- No "&", no "/", no parentheses inside landlord copy.');
  lines.push("- Numbers as digits. Money as $29.95.");
  lines.push('- Say who does what with "we" and "you".');
  lines.push("- Never explain what does not happen. Say what happens.");
  lines.push("- French is written, not translated. Every English key has a French sibling.");
  lines.push("");
  lines.push("## The gate");
  lines.push("");
  lines.push(
    "`npm run test:plain-language` runs on every commit script. It fails when any",
  );
  lines.push(
    "offender is new, or appears MORE often in a file than the baseline records. When",
  );
  lines.push(
    "copy improves it tightens the baseline in place, so the count can only go down",
  );
  lines.push(
    "and a phrase you deleted cannot be pasted back for free. It also fails if a file",
  );
  lines.push("the baseline covers has been dropped from the gate.");
  lines.push("");
  lines.push(
    "`npm run test:plain-language -- --strict` ignores the baseline and is the",
  );
  lines.push("acceptance check for the copy sweep: it goes green when the sweep is finished.");
  lines.push("");
  return lines.join("\n");
}
