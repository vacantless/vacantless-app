// WP0 of ROADMAP-S693: the plain-language gate.
//
// Run: npx tsx scripts/test-plain-language.ts            (ratchet: fails on NEW offenders)
//      npx tsx scripts/test-plain-language.ts --strict    (fails on EVERY offender; red today)
//      npx tsx scripts/test-plain-language.ts --report    (prints every offender, exits 0)
//      npx tsx scripts/test-plain-language.ts --update-baseline
//
// Two things run here, in this order:
//
//  1. SEEDED ASSERTIONS. Every rule is asserted against copy quoted verbatim from
//     ROADMAP-S693 section 12, and against plain copy from sections 2 to 4 that
//     must produce NO finding. These fixtures are inline on purpose: they keep
//     proving the detectors after WP1 has cleaned the real files. A proof that
//     cannot fail is not a proof, so each rule also has a negative twin.
//
//  2. THE SCAN. Every landlord-facing surface in SURFACES is read, its copy
//     strings are pulled out of the TypeScript AST (or the JSON catalog), and
//     every string goes through checkPlainLanguage(). Findings are matched to
//     scripts/plain-language-baseline.json by rule + exact text.
//
// Default mode is the commit gate: it fails when a finding is NOT in the baseline
// (new bad copy) and when a baseline entry no longer matches anything (stale, so
// the count can only go down). --strict ignores the baseline entirely and is the
// WP1 to WP3 acceptance check: it is red today and goes green when the sweep ends.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync, type Dirent } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import {
  PLAIN_LANGUAGE_RULES,
  checkPlainLanguage,
  countWords,
  plainWordsMarkdown,
  splitSentences,
  stripIcu,
  type PlainLanguageFinding,
  type PlainLanguageRule,
} from "../lib/i18n/plain-words";

const ROOT = resolve(__dirname, "..");
const BASELINE_PATH = resolve(ROOT, "scripts/plain-language-baseline.json");
const MARKDOWN_PATH = resolve(ROOT, "lib/i18n/plain-words.md");

// --- the surfaces under the gate ---------------------------------------------
// A surface that disappears is a hole in the gate, so a missing file is a failure,
// never a skip (standing rule: a blocked path is not an absent asset).

type Surface = { file: string; mode: "json" | "ui" };

const SURFACES: Surface[] = [
  { file: "messages/en.json", mode: "json" },
  { file: "messages/fr.json", mode: "json" },
  // The property-page files that survive DECISION-S694 (the seven of ROADMAP
  // section 1, minus the four self-guided ones listed in BEING_REMOVED).
  { file: "app/dashboard/properties/[id]/publish-everywhere.tsx", mode: "ui" },
  { file: "app/dashboard/properties/[id]/channel-publish-rail.tsx", mode: "ui" },
  { file: "app/dashboard/properties/[id]/next-action-card.tsx", mode: "ui" },
  // The wizard.
  { file: "app/dashboard/link-portals/page.tsx", mode: "ui" },
  { file: "app/dashboard/link-portals/connect-tiles.tsx", mode: "ui" },
  { file: "app/dashboard/add-details/page.tsx", mode: "ui" },
  { file: "app/dashboard/add-details/question-sheet-form.tsx", mode: "ui" },
  { file: "app/dashboard/send-live/page.tsx", mode: "ui" },
  { file: "app/dashboard/after-live/page.tsx", mode: "ui" },
  // The Rentals list and Getting started.
  { file: "app/dashboard/properties/page.tsx", mode: "ui" },
  { file: "app/dashboard/properties/readiness-chips.tsx", mode: "ui" },
  { file: "app/dashboard/getting-started-card.tsx", mode: "ui" },
  { file: "app/dashboard/launch-checklist.tsx", mode: "ui" },
  // The catalog. Not just the blurbs: this file also returns the cap lines, cost
  // lines, chip labels, helpers and blocker messages a landlord reads. The
  // operator-only `notes` key is skipped by TECH_PROP_KEYS.
  { file: "lib/distribution-channels.ts", mode: "ui" },
  // The wrapper of the Get online tab, the Post button, the lifecycle rail, and
  // the one line under every site chip (the file WP2 rewrites).
  { file: "app/dashboard/properties/[id]/get-online-view.tsx", mode: "ui" },
  { file: "app/dashboard/properties/[id]/confirm-publish-button.tsx", mode: "ui" },
  { file: "app/dashboard/properties/[id]/lifecycle-rail.tsx", mode: "ui" },
  { file: "lib/distribution-channel-tile-statuses.ts", mode: "ui" },
  // The property page itself. It is the page a landlord lands on and its copy is
  // syndication copy verbatim, so leaving it out understated the real number by
  // about a third.
  { file: "app/dashboard/properties/[id]/page.tsx", mode: "ui" },
  { file: "app/dashboard/properties/[id]/listing-copy-card.tsx", mode: "ui" },
  { file: "app/dashboard/properties/[id]/marketing-kit-card.tsx", mode: "ui" },
  // The dashboard home, where a first-timer starts.
  { file: "app/dashboard/today-lane.tsx", mode: "ui" },
  { file: "app/dashboard/dashboard-nav.tsx", mode: "ui" },
  // The lib modules that BUILD the landlord sentences the pages render. The
  // discovery sweep below found these; without them WP1 could rewrite a page and
  // reintroduce every banned word one layer down.
  { file: "lib/distribution-analytics.ts", mode: "ui" },
  { file: "lib/distribution-capabilities.ts", mode: "ui" },
  { file: "lib/distribution-channel-contracts.ts", mode: "ui" },
  { file: "lib/distribution-freshness.ts", mode: "ui" },
  { file: "lib/distribution-launch-coverage.ts", mode: "ui" },
  { file: "lib/distribution-partner.ts", mode: "ui" },
  { file: "lib/distribution-publish.ts", mode: "ui" },
  { file: "lib/distribution-run.ts", mode: "ui" },
  { file: "lib/distribution-stuck-sweep.ts", mode: "ui" },
  { file: "lib/distribution-verification.ts", mode: "ui" },
  { file: "lib/listing-copy.ts", mode: "ui" },
  { file: "lib/listing-description.ts", mode: "ui" },
  { file: "lib/listing-distribution.ts", mode: "ui" },
  { file: "lib/listing-health.ts", mode: "ui" },
  { file: "lib/listing-quality.ts", mode: "ui" },
  { file: "lib/listing-state.ts", mode: "ui" },
  // Found by the recursive discovery sweep: syndication screens one directory
  // deeper than the first walk could see.
  { file: "app/dashboard/settings/page.tsx", mode: "ui" },
  { file: "app/dashboard/automations/page.tsx", mode: "ui" },
  { file: "app/dashboard/properties/new/add-property-form.tsx", mode: "ui" },
  { file: "app/dashboard/facebook-connect/page.tsx", mode: "ui" },
  { file: "app/dashboard/(wizard)/getting-started/page.tsx", mode: "ui" },
  { file: "app/dashboard/properties/new/page.tsx", mode: "ui" },
  { file: "app/dashboard/properties/standard-policy/page.tsx", mode: "ui" },
];

/**
 * Whole areas of the dashboard that are not syndication. The word contract is
 * meant for them eventually, but the roadmap does not cover them and pulling
 * ~1,200 findings from rent, money and maintenance into the baseline would bury
 * the number that matters. A prefix here excuses everything under it; a file in
 * one of these areas can still be gated individually by listing it in SURFACES.
 */
const OUT_OF_SCOPE_DIRS: Record<string, string> = {
  "app/dashboard/admin": "internal operator console, never seen by a landlord",
  "app/dashboard/availability": "viewing windows, not syndication",
  "app/dashboard/billing": "subscription and payment, not syndication",
  "app/dashboard/captures": "inbox capture tool, not syndication",
  "app/dashboard/expenses": "bookkeeping, not syndication",
  "app/dashboard/leads": "inquiry inbox, not syndication",
  "app/dashboard/leasing": "screening and qualifying, not syndication",
  "app/dashboard/maintenance": "work orders and notices, not syndication",
  "app/dashboard/me": "personal settings, not syndication",
  "app/dashboard/messages": "tenant messaging, not syndication",
  "app/dashboard/money": "accounting, not syndication",
  "app/dashboard/people": "contacts, not syndication",
  "app/dashboard/referrals": "referrals, not syndication",
  "app/dashboard/rent": "rent collection, not syndication",
  "app/dashboard/reports": "reporting, not syndication",
  "app/dashboard/showing-agents": "showing agents, not syndication",
  "app/dashboard/showings": "showings, not syndication",
  "app/dashboard/tenancies": "tenancies, not syndication",
  "app/dashboard/tenants": "tenants, not syndication",
};

/**
 * Files the discovery sweep flags that are deliberately NOT gated, each with the
 * reason. Only files that actually break the contract need an entry: anything
 * with clean copy passes discovery silently and is never listed here.
 */
const OUT_OF_SCOPE: Record<string, string> = {
  // The property page's other tabs. Real landlord copy, but not syndication:
  // the word contract reaches them after the roadmap, not during it.
  "app/dashboard/properties/[id]/appliances-section.tsx": "unit facts tab, not syndication",
  "app/dashboard/properties/[id]/detectors-section.tsx": "unit facts tab, not syndication",
  "app/dashboard/properties/[id]/documents-section.tsx": "documents tab, not syndication",
  "app/dashboard/properties/[id]/dropbox-folder-import.tsx": "photo import tool, not syndication",
  "app/dashboard/properties/[id]/equipment-section.tsx": "unit facts tab, not syndication",
  "app/dashboard/properties/[id]/market-rent-panel.tsx": "pricing panel, not syndication",
  "app/dashboard/properties/[id]/photo-manager.tsx": "photos tab, not syndication",
  "app/dashboard/properties/[id]/waitlist-card.tsx": "waitlist, not syndication",
  "app/dashboard/properties/listing-image-import.tsx": "import tool, not syndication",
  "app/dashboard/properties/mls-pdf-import.tsx": "import tool, not syndication",
  "app/dashboard/page.tsx":
    "dashboard home: database selects and layout; its landlord copy lives in today-lane.tsx",
  "app/dashboard/properties/actions.ts":
    "server action results; the error copy a landlord sees comes in with WP6",
  "app/dashboard/properties/distribution-actions.ts":
    "server action results and database selects, not rendered copy",
  "lib/distribution-session-crypto.ts": "internal invariant messages, never rendered",
  "lib/distribution-session-status.ts": "internal invariant messages, never rendered",
  "lib/distribution-worker.ts": "worker invariant messages, never rendered",
  "lib/distribution-worker-ai.ts": "HTTP plumbing, no copy",
  "lib/listing-extract.ts": "prompt text sent to a model, read by no landlord",
  "lib/listing-extract-vision.ts": "prompt text sent to a model, read by no landlord",
  "lib/listing-feed.ts": "machine readable XML feed template",
  "lib/listing-post-live-check.ts":
    "operator log lines for the S693 live check; roadmap section 8 says never show them",
};

/**
 * The self-guided posting path, which DECISION-S694 deletes. S695 cut the first
 * seven files (the per-portal paste sheet, "before you post" gotchas, the
 * browser co-pilot lib, panel and sidecar, the paste-your-ad checker: 447 of
 * the 1140 offenders sat there, DECISION-S695-SYNDICATION-SURFACES-THAT-SURVIVE).
 * The assisted launch checklist followed later the same session. What is left
 * here is the slimmed command centre: its channel cards own the only Connect /
 * Disconnect Facebook Page controls (fa4a808) and stay until the Meta verdict
 * (2026-09-22), then move to Settings with the tracked-post rows. Their copy is not swept and not counted: polishing words on a screen
 * about to be removed is wasted work. While a file still exists it is excused
 * from discovery like OUT_OF_SCOPE; once it is deleted its entry here must go
 * too, so the list can never quietly outlive the code.
 *
 * What survives is listed in SURFACES: the intake (the question sheet), the
 * sign-in tiles, the one button, the after-live status, the catalog, the tile
 * states, the property page and the engine modules that build the sentences a
 * landlord still reads. `lib/distribution-run.ts` stays gated on purpose: its
 * run-item state machine feeds the worker, only its `buildRunSteps` checklist
 * copy belongs to the removed path.
 */
const BEING_REMOVED: Record<string, string> = {
  "app/dashboard/properties/[id]/distribute-tab.tsx":
    "assisted-manual command centre; its tracked-post rows move to the after-live status",
};

/**
 * The whole dashboard subtree is swept for landlord copy that is NOT yet gated,
 * plus the syndication modules in lib/. Any .ts or .tsx in here that is neither
 * in SURFACES nor in OUT_OF_SCOPE is extracted and checked: if it breaks the
 * contract even once, the gate fails until somebody either gates it or excuses
 * it with a reason. Files with clean copy need no entry, so the list maintains
 * itself. It recurses, because a depth-1 walk left the Copilot posting screen
 * and 119 offenders in Settings both ungated and unexcused.
 */
const DISCOVERY_ROOT = "app/dashboard";
const DISCOVERY_MAX_DEPTH = 6;

/** In lib/, only the syndication modules are swept. */
const DISCOVERY_LIB_PREFIXES = ["distribution-", "listing-"];

/**
 * "page 2.tsx", "route 3.ts": the shape a Finder or sync copy leaves behind.
 * They are not routes and not modules, they are duplicates of a file that is
 * already gated, and this repo has fourteen of them. Reported on every run so
 * they stay visible, but not treated as a surface anyone must classify.
 */
export function isDuplicateArtifact(name: string): boolean {
  return /\s\d+\.tsx?$/.test(name);
}

// --- extraction ---------------------------------------------------------------

export type Candidate = { file: string; where: string; text: string };

const TECH_JSX_ATTRS = new Set([
  "className",
  "class",
  "id",
  "key",
  "href",
  "src",
  "type",
  "role",
  "name",
  "htmlFor",
  "value",
  "style",
  "rel",
  "target",
  "method",
  "action",
  "accept",
  "autoComplete",
  "inputMode",
  "pattern",
  "data-testid",
]);

const TECH_PROP_KEYS = new Set([
  "className",
  "href",
  "src",
  "id",
  "key",
  "name",
  "slug",
  "path",
  "url",
  "portalUrl",
  "query",
  "select",
  "table",
  "column",
  "code",
  "event",
  "testId",
  "copyKey",
  "note",
  "notes",
  "icon",
  "color",
  "variant",
  "mode",
  "category",
  "connectKind",
  "integrationStatus",
]);

/** Is this string plausibly copy a landlord reads, rather than code? */
export function looksLikeCopy(raw: string): boolean {
  const text = raw.trim();
  if (text.length < 2) return false;
  if (!/[A-Za-zÀ-ÿ]{2}/.test(text)) return false;
  // A string that is only interpolation is a passthrough, not copy.
  if (!/[A-Za-zÀ-ÿ]{2}/.test(text.replace(/\{[^{}]*\}/g, " "))) return false;
  if (/^https?:\/\//i.test(text) || text.includes("://")) return false;
  if (/^[./~#@]/.test(text)) return false;
  // Case sensitive on purpose: "kebab-case" is an identifier, "Re-publish" is a
  // button label. The case-insensitive version hid seven banned words.
  if (/^[a-z]+([-_][a-z0-9]+)+$/.test(text)) return false;
  if (/^\s*(select|insert|update|delete|create|alter)\s/i.test(text)) return false;
  // CSS values reach the AST as ordinary strings and are not copy.
  if (/\b(?:var|rgba?|hsla?|calc|linear-gradient|translate[XY]?|url)\(/.test(text)) return false;
  // Redirect targets and mailto links carry "&" and "=" and are not copy.
  if (/\?\s*[\w-]+\s*=/.test(text) || /^mailto:/i.test(text)) return false;

  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    // A one word button is copy: "Publish", "Sync", "Re-publish", "Done-for-you".
    // An internal capital means PascalCase, which is an identifier, and an
    // all lower case token is one too. A shouted badge ("REMOVED") is copy.
    if (/^[A-Z][a-zà-ÿ]+(?:-[a-zà-ÿ0-9]+)*$/.test(text)) return true;
    return /^[A-Z][A-Z0-9!.'’-]*$/.test(text) && text.replace(/[^A-Z]/g, "").length >= 3;
  }
  // A tailwind-shaped class list: no capitals anywhere and dashed or prefixed tokens.
  const noCapitals = !/[A-Z]/.test(text);
  const classy = tokens.filter((t) => /[-:]/.test(t) && /^[-a-z0-9:./[\]%#!_(),]+$/.test(t));
  if (noCapitals && classy.length >= Math.ceil(tokens.length * 0.5)) return false;
  // All snake_case identifiers.
  if (tokens.every((t) => /^[a-z0-9]+(_[a-z0-9]+)+$/.test(t))) return false;
  // A Supabase select() column list is not copy, and "fixing" a banned word
  // inside one would rename a database column. Deliberately narrow: several
  // comma separated bare lower case identifiers, at least one of them
  // snake_case, and no sentence punctuation. A real list a landlord reads,
  // "beds, baths, parking, laundry", has no underscore and still counts.
  const commaItems = text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (
    commaItems.length >= 4 &&
    !/[.!?:;]/.test(text) &&
    commaItems.every((t) => /^[a-z][a-z0-9_]*$/.test(t)) &&
    commaItems.some((t) => t.includes("_"))
  ) {
    return false;
  }
  return true;
}

function jsxAttrName(node: ts.Node): string | null {
  const parent = node.parent;
  if (parent && ts.isJsxAttribute(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (
    parent &&
    ts.isJsxExpression(parent) &&
    parent.parent &&
    ts.isJsxAttribute(parent.parent) &&
    ts.isIdentifier(parent.parent.name)
  ) {
    return parent.parent.name.text;
  }
  return null;
}

function propKeyName(node: ts.Node): string | null {
  const parent = node.parent;
  if (parent && ts.isPropertyAssignment(parent) && parent.initializer === node) {
    const name = parent.name;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  }
  return null;
}

function isModuleSpecifier(node: ts.Node): boolean {
  const parent = node.parent;
  return Boolean(
    parent &&
      (ts.isImportDeclaration(parent) ||
        ts.isExportDeclaration(parent) ||
        ts.isImportTypeNode(parent) ||
        (ts.isCallExpression(parent) &&
          parent.expression.kind === ts.SyntaxKind.ImportKeyword)),
  );
}

function isInsideConsoleCall(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      ts.isIdentifier(current.expression.expression) &&
      current.expression.expression.text === "console"
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function isTypePosition(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isLiteralTypeNode(current) || ts.isTypeAliasDeclaration(current)) return true;
    if (ts.isBlock(current) || ts.isSourceFile(current)) return false;
    current = current.parent;
  }
  return false;
}

/**
 * JSX writes an apostrophe as &apos;, so the raw source of a clean sentence
 * contains an ampersand the landlord never sees. Decode before checking, or the
 * ampersand rule fires on every contraction in the product.
 */
export function decodeEntities(text: string): string {
  return text
    .replace(/&(?:apos|#39|rsquo|lsquo);/g, "'")
    .replace(/&(?:quot|#34|ldquo|rdquo);/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&ndash;/g, "\u2013")
    .replace(/&hellip;/g, "...")
    .replace(/&(?:larr|rarr|uarr|darr|times|middot|bull|deg);/g, " ")
    .replace(/&(?:lt|gt);/g, " ")
    .replace(/&amp;/g, "&");
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

export function extractFromSource(file: string, code: string): Candidate[] {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Candidate[] = [];
  const seen = new Set<string>();

  // A newline inside a string literal is a real line break the renter sees, so
  // it must survive to the sentence splitter. A newline inside JSX text is just
  // source wrapping, so collapsing it is what keeps a wrapped paragraph one
  // sentence and stops the length rule going soft.
  const push = (node: ts.Node, text: string, keepBreaks = false) => {
    const decoded = decodeEntities(text);
    const trimmed = keepBreaks
      ? decoded
          .replace(/[^\S\r\n]+/g, " ")
          .replace(/[ \t]*\r?\n[ \t]*/g, "\n")
          .trim()
      : decoded.replace(/\s+/g, " ").trim();
    if (!looksLikeCopy(trimmed)) return;
    const where = `line ${lineOf(source, node)}`;
    const dedupe = `${where}|${trimmed}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push({ file, where, text: trimmed });
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      push(node, node.text);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const attr = jsxAttrName(node);
      const key = propKeyName(node);
      const skip =
        isModuleSpecifier(node) ||
        isInsideConsoleCall(node) ||
        isTypePosition(node) ||
        (attr !== null && TECH_JSX_ATTRS.has(attr)) ||
        (key !== null && TECH_PROP_KEYS.has(key));
      if (!skip) push(node, node.text, true);
    } else if (ts.isTemplateExpression(node)) {
      if (!isInsideConsoleCall(node)) {
        const joined = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(
          " {value} ",
        );
        push(node, joined, true);
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return out;
}

export function flattenJson(value: unknown, prefix = ""): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  if (typeof value === "string") {
    out.push({ key: prefix, text: value });
    return out;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.push(...flattenJson(v, prefix ? `${prefix}.${k}` : k));
    }
  }
  return out;
}

/**
 * ROADMAP section 9 rule 5: fr.json must carry every key en.json has, no key it
 * does not, and no empty string. Pure so it can be asserted on fixtures; today
 * the two catalogs are in parity, so without fixtures this rule would ship
 * unproven.
 */
export function catalogParityFindings(
  en: { key: string; text: string }[],
  fr: { key: string; text: string }[],
): PlainLanguageFinding[] {
  const out: PlainLanguageFinding[] = [];
  const frByKey = new Map(fr.map((e) => [e.key, e.text]));
  const enKeys = new Set(en.map((e) => e.key));
  for (const entry of en) {
    const sibling = frByKey.get(entry.key);
    if (sibling === undefined) {
      out.push({
        rule: "fr_missing_key",
        text: entry.key,
        detail: `messages/fr.json has no "${entry.key}"`,
      });
    } else if (!sibling.trim()) {
      out.push({
        rule: "fr_empty",
        text: entry.key,
        detail: `messages/fr.json "${entry.key}" is empty`,
      });
    }
  }
  for (const entry of fr) {
    if (!enKeys.has(entry.key)) {
      out.push({
        rule: "fr_extra_key",
        text: entry.key,
        detail: `messages/fr.json has "${entry.key}" and messages/en.json does not`,
      });
    }
  }
  return out;
}

// --- seeded assertions --------------------------------------------------------

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}
function eq(name: string, actual: unknown, expected: unknown) {
  ok(name, actual === expected);
  if (actual !== expected) {
    console.error(`    expected: ${String(expected)}`);
    console.error(`    actual:   ${String(actual)}`);
  }
}
function rulesOf(text: string): PlainLanguageRule[] {
  return [...new Set(checkPlainLanguage(text).map((f) => f.rule))].sort();
}
function fires(name: string, rule: PlainLanguageRule, text: string) {
  ok(`${rule}: ${name}`, rulesOf(text).includes(rule));
}
function quiet(name: string, text: string) {
  const found = rulesOf(text);
  ok(`clean: ${name}`, found.length === 0);
  if (found.length) console.error(`    fired: ${found.join(", ")} on ${JSON.stringify(text)}`);
}

function runSeededAssertions() {
  // Offenders quoted verbatim from ROADMAP-S693 section 12.
  fires("stage3.sending dash", "em_dash", "Sending now — please keep this screen open");
  fires("copilot dash", "em_dash", "Captured from the extension — review it, then mark it live.");

  fires("stage1 button caps", "all_caps", "TELL US YOUR {name} ACCOUNT");
  fires("stage1 status caps", "all_caps", "ALREADY LINKED");
  fires("two word caps", "all_caps", "NOT LINKED YET");
  fires("badge caps", "all_caps", "REMOVING...");
  fires("blast caps", "all_caps", "CLICK HERE TO SEND THIS LISTING TO ALL PORTALS NOW");

  fires("catalog feed candidate", "banned_word", "Rentals.ca is a feed candidate, not a live Vacantless integration.");
  fires("portals plural", "banned_word", "CLICK HERE TO SEND THIS LISTING TO ALL PORTALS NOW");
  fires("proof on the rail", "banned_word", "Nothing is posted, paid, or marked Live without approval and proof");
  fires("renter page", "banned_word", "GET ONLINE: Renter page not live");
  fires("tracked inquiry link", "banned_word", "tracked inquiry link");
  fires("dispatch a network agent", "banned_word", "Dispatch a network agent");
  fires("spend limit", "banned_word", "Set the landlord pass-through spend limit before this paid channel can launch.");
  fires("one listing", "banned_word", "Launch everywhere from one listing");

  fires("ampersand in stage name", "ampersand_or_slash", "Choose & send live");
  fires("slash in status", "ampersand_or_slash", "AGENT / MLS ONLY");

  fires("parentheses in a label", "parentheses", "Public description (polished for you)");

  fires(
    "long sentence",
    "sentence_length",
    "Vacantless will use the existing reminder cycle instead of pretending it can safely refresh without the missing consent.",
  );
  fires(
    "long lifecycle sentence",
    "sentence_length",
    "Removal is part of the same listing lifecycle; the ad is not treated as removed until the ad link is saved.",
  );

  fires("nothing happens", "negative_promise", "Nothing is posted automatically. You approve outside-site posts, paid steps, and live proof.");
  fires("never stores", "negative_promise", "Vacantless never stores your card.");
  // The one carved-out sentence: S691 requires this credential guarantee, and the
  // roadmap proposes it in section 6. It must stay silent, and only in these words.
  quiet("credential guarantee is exempt", "Vacantless never signs in as you.");
  quiet("password guarantee is exempt", "We never see your password.");
  fires("a different never is still caught", "negative_promise", "We never share your email.");

  // The replacements from sections 2 to 4 must be silent, or the gate is unusable.
  quiet("ready line", "We post it when you press Post.");
  quiet("needs you line", "Sign in on Kijiji first.");
  quiet("cost line kijiji", "Free for 1 ad. The next one is $29.95.");
  quiet("cost line zumper", "Free for 5 listings.");
  quiet("free header", "Free sites. Do these first.");
  quiet("next step sentence", "Answer 1 question. Then you can post to 4 free sites.");
  quiet("live line", "Posted Sep 7. See your ad.");
  quiet("taken down", "Kijiji took this ad down on Sep 7. Post it again?");
  quiet("button", "Add photos");
  quiet("safety plain sibling", "You approve every post. You pay a site only if it asks.");
  quiet("blurb kijiji", "We write the ad. You sign in on Kijiji, post it, and we save the link.");
  quiet("blurb realtor", "Your real estate agent posts here. We give them the details.");

  // Rule mechanics, so a broken detector cannot pass by accident.
  eq("stripIcu collapses a plural block", stripIcu("{count, plural, one {# left} other {# left}} today"), "value today");
  eq("decimal is not a full stop", splitSentences("It costs $29.95 each time.").length, 1);
  eq("ellipsis is one break", splitSentences("Saving... Almost there.").length, 2);
  const tooLongSentences = (text: string) =>
    checkPlainLanguage(text).filter((f) => f.rule === "sentence_length");
  eq("two sentences split", splitSentences("Posted Sep 7. See your ad.").length, 2);
  // A line break ends a sentence. A paste sample or a stacked label is not one
  // run-on sentence, and measuring it as one gives the writer nothing to fix.
  eq("line break ends a sentence", splitSentences("Address: 123 Main St\nRent: $1,950").length, 2);
  eq(
    "multi line sample is measured per line",
    tooLongSentences("Paste it here, e.g.\nAddress: 123 Main St, Unit 4\nList Price: $1,950 Monthly\nBedrooms: 2").length,
    0,
  );
  eq(
    "a real run-on still fails across a line break",
    tooLongSentences(
      "This one sentence keeps going and going and going and going and going past the gate\nshort tail",
    ).length,
    1,
  );
  eq("blank lines do not make empty sentences", splitSentences("One.\n\n\nTwo.").length, 2);
  eq("word count ignores punctuation", countWords("Free for 5 listings."), 4);
  eq("acronym alone is not shouting", rulesOf("MLS").length, 0);
  eq("brand alone is quiet", rulesOf("Vacantless").length, 0);
  eq("14 words passes", rulesOf("one two three four five six seven eight nine ten more words again here").length, 0);
  fires(
    "15 words fails",
    "sentence_length",
    "one two three four five six seven eight nine ten more words again here now",
  );
  eq("class list is not copy", looksLikeCopy("mt-2 flex items-center gap-2 rounded-md"), false);
  eq("url is not copy", looksLikeCopy("https://www.kijiji.ca/v-apartments"), false);
  eq("snake case is not copy", looksLikeCopy("needs_login sheet_incomplete"), false);
  eq("a sentence is copy", looksLikeCopy("Sign in on Kijiji first."), true);
  eq("a shouted badge is copy", looksLikeCopy("REMOVED"), true);
  eq("a redirect target is not copy", looksLikeCopy("/dashboard/billing?checkout=success&x=1"), false);
  eq("a Finder duplicate is recognised", isDuplicateArtifact("page 2.tsx"), true);
  eq("a deeper duplicate is recognised", isDuplicateArtifact("app/x/route 3.ts"), true);
  eq("a real page is not a duplicate", isDuplicateArtifact("page.tsx"), false);
  eq("a numbered real file is not a duplicate", isDuplicateArtifact("step2.tsx"), false);
  eq("a mailto link is not copy", looksLikeCopy("mailto:a@b.ca?subject=Hi&body=There"), false);
  eq("placeholder only is not copy", looksLikeCopy("{value} {value}"), false);
  eq("placeholder plus a word is copy", looksLikeCopy("{value} live"), true);
  eq("one word button is copy", looksLikeCopy("Publish"), true);
  eq("one word banned button fires", rulesOf("Publish").includes("banned_word"), true);
  eq("lower case token is not copy", looksLikeCopy("publish"), false);
  eq("pascal case enum is not copy", looksLikeCopy("NotStarted"), false);
  eq("apostrophe entity is not an ampersand", decodeEntities("You&apos;re online"), "You're online");
  eq("amp entity stays an ampersand", decodeEntities("Choose &amp; send"), "Choose & send");
  eq("mdash entity is a dash", rulesOf(decodeEntities("Sending now &mdash; wait")).includes("em_dash"), true);
  eq("decoded contraction is quiet", rulesOf(decodeEntities("You&apos;re online")).length, 0);

  // Catalog parity, on fixtures: the real catalogs are in parity today, so these
  // three rules would otherwise ship untested.
  {
    const en = [
      { key: "a.one", text: "Post it" },
      { key: "a.two", text: "Sign in" },
      { key: "a.three", text: "Add photos" },
    ];
    const fr = [
      { key: "a.one", text: "Publier" },
      { key: "a.two", text: "   " },
      { key: "a.four", text: "Extra" },
    ];
    const parity = catalogParityFindings(en, fr);
    const rules = parity.map((f) => `${f.rule}:${f.text}`).sort();
    eq("parity finds the missing key", rules.includes("fr_missing_key:a.three"), true);
    eq("parity finds the empty string", rules.includes("fr_empty:a.two"), true);
    eq("parity finds the extra key", rules.includes("fr_extra_key:a.four"), true);
    eq("parity is silent on a good key", rules.some((r) => r.endsWith("a.one")), false);
    eq("parity finds nothing when the catalogs match", catalogParityFindings(en, en).length, 0);
  }

  // Regressions the S694 reviewer proved. Each of these was a live hole.
  eq("hyphenated label is copy", looksLikeCopy("Done-for-you"), true);
  eq("hyphenated label fires", rulesOf("Re-publish").includes("banned_word"), true);
  eq("kebab identifier is still not copy", looksLikeCopy("needs-login-state"), false);
  fires("inflected publish", "banned_word", "Published to 3 sites.");
  fires("inflected launching", "banned_word", "Launching now.");
  fires("inflected removing", "banned_word", "Removing the ad.");
  fires("inflected syncing", "banned_word", "Syncing your ad.");
  fires("hyphenated compound", "banned_word", "Portal-level settings");
  eq("hyphenated ban keeps its guard", rulesOf("nonone-tapping").includes("banned_word"), false);
  fires("abbreviation does not hide a long sentence", "sentence_length",
    "Send it, e.g. to Kijiji and Facebook and Zumper and Rentals and Viewit and RentFaster today.");
  eq("abbreviation keeps one sentence", splitSentences("Send it, e.g. to Kijiji today.").length, 1);
  eq("Dr is not a full stop", splitSentences("Dr. Smith has the keys.").length, 1);
  eq("month abbreviation is not a full stop", splitSentences("Posted Sep. 7 by us.").length, 1);
  fires("french shouting", "all_caps", "Votre site est PRÊT DÉJÀ maintenant.");
  fires("one shouted word in a sentence", "all_caps", "Your ad is LIVE today.");
  eq("allowlisted acronym in a sentence is quiet", rulesOf("Ask your agent about the MLS route.").length, 0);
  fires("unbalanced brace does not blind the caps rule", "all_caps", "Post it { NOW SHOUTING LOUD");
  eq("unbalanced brace falls back to raw text", stripIcu("Post it { now"), "Post it   now");
  fires("tight double hyphen", "em_dash", "Post it now--we save the link.");
  eq("tailwind with an arbitrary value is not copy",
    looksLikeCopy("bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.16)]"), false);
  eq("CAD is an allowed acronym", rulesOf("CAD").length, 0);
  eq("arrow entity is not an ampersand", rulesOf(decodeEntities("&larr; Simple view")).length, 0);

  // The ratchet arithmetic. Sabotaging this half used to pass every assertion,
  // so the half most likely to be quietly broken now has its own.
  {
    const F = (rule: PlainLanguageRule, file: string, text: string) => ({ rule, file, text });
    const entriesOf = (e: BaselineEntry[]) => ({
      entries: e,
      totals: Object.fromEntries(countByFileRule(e)),
    });
    const baseEntries: BaselineEntry[] = [
      { rule: "banned_word", file: "a.tsx", text: "Launch it", count: 2 },
      { rule: "banned_word", file: "b.tsx", text: "Launch it", count: 1 },
    ];
    const base = entriesOf(baseEntries);
    const same = [
      F("banned_word", "a.tsx", "Launch it"),
      F("banned_word", "a.tsx", "Launch it"),
      F("banned_word", "b.tsx", "Launch it"),
    ];
    eq("counts are per file", countByFingerprint(same).size, 2);
    eq("count adds up", countByFingerprint(same).get(fingerprint(F("banned_word", "a.tsx", "Launch it")))?.count, 2);
    eq("matching run is clean", compareToBaseline(same, base).excess.length, 0);

    eq(
      "one extra occurrence is excess",
      compareToBaseline([...same, F("banned_word", "a.tsx", "Launch it")], base).excess.length,
      1,
    );

    // The move a global count cannot see: same total, different file.
    const moved = [
      F("banned_word", "a.tsx", "Launch it"),
      F("banned_word", "c.tsx", "Launch it"),
      F("banned_word", "c.tsx", "Launch it"),
    ];
    eq("moving a phrase to another file is excess", compareToBaseline(moved, base).excess.length, 1);

    // A PARTIAL fix must not read as a new offender. The string changed, but the
    // file has no more banned words than before, so the gate stays green.
    const partial = [
      F("banned_word", "a.tsx", "Launch it now please"),
      F("banned_word", "a.tsx", "Launch it"),
      F("banned_word", "b.tsx", "Launch it"),
    ];
    eq("rewording without adding a violation is not excess", compareToBaseline(partial, base).excess.length, 0);
    ok("rewording still shows as improvement", compareToBaseline(partial, base).improved.length > 0);

    // Swapping a violation for a different one in the same file is NOT caught.
    // Recorded here so the limit is a decision, not a surprise.
    eq(
      "a like for like swap inside one file is deliberately allowed",
      compareToBaseline(
        [F("banned_word", "a.tsx", "Sync it"), F("banned_word", "a.tsx", "Launch it"), F("banned_word", "b.tsx", "Launch it")],
        base,
      ).excess.length,
      0,
    );

    const fewer = [F("banned_word", "b.tsx", "Launch it")];
    const cmp = compareToBaseline(fewer, base);
    eq("deleting occurrences is not excess", cmp.excess.length, 0);
    eq("deleting occurrences is improvement", cmp.improved.length, 1);
    eq("improvement is counted in occurrences", cmp.improvedOccurrences, 2);

    // The pawl: after tightening, re-adding the deleted copy is excess.
    const tightenedBase = tightenedEntries(countByFingerprint(fewer), baseEntries);
    eq("tightening drops the emptied entry", tightenedBase.length, 1);
    eq("tightening keeps the surviving count", tightenedBase[0]?.count, 1);
    eq(
      "re-adding what was removed is caught after tightening",
      compareToBaseline(same, { entries: tightenedBase, totals: tightenedTotals(fewer, base.totals) }).excess.length,
      1,
    );

    eq("an empty baseline makes everything excess", compareToBaseline(same, { entries: [], totals: {} }).excess.length, 2);
    eq("file and rule totals add up", countByFileRule(baseEntries).get(`a.tsx\u0000banned_word`), 2);
    ok("checksum changes with the entries", checksumOf(baseEntries) !== checksumOf(tightenedBase));
    eq(
      "checksum is stable for the same entries",
      checksumOf(baseEntries),
      checksumOf([...baseEntries].reverse()),
    );
    ok("checksum changes when only the totals change", checksumOf(baseEntries, { x: 1 }) !== checksumOf(baseEntries, { x: 2 }));

    // The allowance must survive a reword: the string is gone from the worklist
    // but the file still has the same number of banned words.
    const reworded = [
      F("banned_word", "a.tsx", "Launch it later"),
      F("banned_word", "a.tsx", "Launch it"),
      F("banned_word", "b.tsx", "Launch it"),
    ];
    const afterTighten = {
      entries: tightenedEntries(countByFingerprint(reworded), baseEntries),
      totals: tightenedTotals(reworded, base.totals),
    };
    eq(
      "a reworded string does not become excess on the next run",
      compareToBaseline(reworded, afterTighten).excess.length,
      0,
    );
  }

  // The guards themselves. Each of these could previously be neutered with every
  // assertion still green, which is the failure mode that matters most in a gate.
  {
    eq("a dropped surface is detected", droppedSurfaces(["a.ts", "b.ts"], ["a.ts"]).length, 1);
    eq("no drop when everything is still gated", droppedSurfaces(["a.ts"], ["a.ts", "b.ts"]).length, 0);
    {
      const files: Record<string, string> = {
        "app/x/page.tsx": 'import { a } from "@/lib/gone";\nimport { b } from "./rail";\n',
        "app/x/rail.tsx": 'import { c } from "../../lib/gone";\n',
        "lib/keep.ts": 'import type { T } from "@/lib/gone";\nexport const k = 1;\n',
        "lib/other.ts": 'import { z } from "@/lib/zed";\n',
      };
      const read = (f: string) => {
        if (!(f in files)) throw new Error(f);
        return files[f];
      };
      const got = survivorsImportingRemoved(Object.keys(files), ["lib/gone.ts"], read);
      eq("survivors importing a removed module are found", got.length, 3);
      ok("an alias import is resolved", got.some((r) => r.file === "app/x/page.tsx"));
      ok("a relative import is resolved", got.some((r) => r.file === "app/x/rail.tsx"));
      ok("an unrelated import is not reported", !got.some((r) => r.file === "lib/other.ts"));
      eq(
        "the removed module is named, once, per importer",
        got.find((r) => r.file === "app/x/page.tsx")?.imports.join(","),
        "lib/gone.ts",
      );
      eq(
        "a root-level file resolves its relative import",
        survivorsImportingRemoved(["root.ts"], ["gone.ts"], () => 'import { a } from "./gone";\nimport { b } from "./gone";\n')
          .map((r) => r.imports.join(","))
          .join("|"),
        "gone.ts",
      );
      eq("an unreadable survivor is skipped", survivorsImportingRemoved(["nope.ts"], ["lib/gone.ts"], read).length, 0);
    }

    eq("pawl fires on a clean improvement", shouldTighten({ excess: 0, failed: 0, dropped: 0, improved: 3 }), true);
    eq(
      "pawl does not fire when the allowance did not actually fall",
      shouldTighten({ excess: 0, failed: 0, dropped: 0, improved: 0 }),
      false,
    );

    // A surface that reads and parses but yields far fewer strings is blind.
    eq("a shrunken surface is detected", shrunkSurfaces({ "a.tsx": 100 }, { "a.tsx": 40 }).length, 1);
    eq("a surface gone to zero is detected", shrunkSurfaces({ "a.tsx": 100 }, {}).length, 1);
    eq("a small fall is normal copy work", shrunkSurfaces({ "a.tsx": 100 }, { "a.tsx": 90 }).length, 0);
    eq("a growing surface is fine", shrunkSurfaces({ "a.tsx": 100 }, { "a.tsx": 130 }).length, 0);
    eq("an unrecorded surface is not judged", shrunkSurfaces({}, { "a.tsx": 3 }).length, 0);

    // The checksum CALL SITE, not just the hash: this seam had no assertion and
    // turning it off let a hand-raised allowance through.
    const fixtureEntries: BaselineEntry[] = [
      { rule: "banned_word", file: "a.tsx", text: "Launch it", count: 1 },
    ];
    const fixtureTotals = { [`a.tsx\u0000banned_word`]: 1 };
    eq(
      "a good baseline reads back untampered",
      baselineIsTampered({
        entries: fixtureEntries,
        totals: fixtureTotals,
        checksum: checksumOf(fixtureEntries, fixtureTotals),
      }),
      false,
    );
    eq(
      "a hand raised allowance is tampering",
      baselineIsTampered({
        entries: fixtureEntries,
        totals: { [`a.tsx\u0000banned_word`]: 6 },
        checksum: checksumOf(fixtureEntries, fixtureTotals),
      }),
      true,
    );
    eq(
      "a missing checksum is tampering",
      baselineIsTampered({ entries: fixtureEntries, totals: fixtureTotals }),
      true,
    );

    // The floor the commit script relies on.
    eq("below the floor is caught", belowFloor(10, 20), true);
    eq("at the floor is fine", belowFloor(20, 20), false);
    eq("no floor asked for, nothing enforced", belowFloor(0, null), false);
    eq("pawl refuses while something got worse", shouldTighten({ excess: 1, failed: 0, dropped: 0, improved: 3 }), false);
    eq("pawl refuses after an assertion failure", shouldTighten({ excess: 0, failed: 1, dropped: 0, improved: 3 }), false);
    eq("pawl refuses when a surface went missing", shouldTighten({ excess: 0, failed: 0, dropped: 1, improved: 3 }), false);
    eq("pawl does nothing when nothing improved", shouldTighten({ excess: 0, failed: 0, dropped: 0, improved: 0 }), false);
    eq(
      "pawl fires however large the improvement is",
      shouldTighten({ excess: 0, failed: 0, dropped: 0, improved: 9999 }),
      true,
    );

    // A written baseline must record every gated surface, or the blindness guard
    // is disarmed on the next write.
    // Skipped while rewriting the baseline: it is read before the new one lands.
    const rewriting = process.argv.includes("--update-baseline");
    const written = rewriting
      ? ({ surfaces: SURFACES.map((s) => s.file), entries: [], checksum: "skipped" } as unknown as Baseline)
      : (JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline);
    const missing = SURFACES.map((s) => s.file).filter((f) => !(written.surfaces ?? []).includes(f));
    ok(
      "the baseline on disk records every gated surface",
      missing.length === 0 || written.entries.length === 0,
    );
    if (missing.length && written.entries.length) {
      console.error(`    baseline is missing surfaces: ${missing.slice(0, 5).join(", ")}`);
      console.error("    run: npm run test:plain-language -- --update-baseline");
    }
    ok("the baseline on disk carries a checksum", Boolean(written.checksum));
    eq(
      "a wrong checksum is detected",
      checksumOf([{ rule: "banned_word", file: "a.ts", text: "x", count: 1 }]) === written.checksum,
      false,
    );
    ok("the baseline records at least one surface", (written.surfaces ?? []).length > 0);
  }

  // The extractor must see JSX text and skip className.
  const sample = [
    'const cls = "flex items-center gap-2";',
    "export function X() {",
    '  return <div className="mt-2 text-sm">Nothing is posted without approval and proof</div>;',
    "}",
  ].join("\n");
  const got = extractFromSource("sample.tsx", sample);
  ok("extractor finds the JSX sentence", got.some((c) => c.text.startsWith("Nothing is posted")));
  ok("extractor skips the class list", !got.some((c) => c.text.includes("items-center")));

  // A select() column list is not copy. The guard is narrow on purpose: a real
  // comma list a landlord reads must still be measured.
  ok(
    "select column list is not copy",
    !looksLikeCopy("id, organization_id, address, rent_cents, beds, posted_on"),
  );
  ok(
    "listing_posts select list is not copy",
    !looksLikeCopy("id, portal, label, url, status, posted_on, created_at, notes"),
  );
  ok("a plain comma list is still copy", looksLikeCopy("beds, baths, parking, laundry"));
  ok(
    "a sentence with commas is still copy",
    looksLikeCopy("Add rent, beds, baths, and photos now or later."),
  );

  // The two newline kinds, held apart. A wrapped JSX paragraph must stay ONE
  // sentence or the length rule goes soft; a \n inside a string literal is a
  // real break the renter sees and must split.
  {
    const wrapped = extractFromSource(
      "w.tsx",
      "const A = () => (\n  <p>\n    This one paragraph is wrapped across several source lines and keeps\n    going well past the fourteen word gate on purpose.\n  </p>\n);\n",
    );
    const para = wrapped.find((c) => c.text.startsWith("This one paragraph"));
    ok("wrapped JSX text is found", Boolean(para));
    eq("wrapped JSX text stays one sentence", splitSentences(para?.text ?? "").length, 1);
    eq(
      "wrapped JSX run-on still fails the length rule",
      tooLongSentences(para?.text ?? "").length,
      1,
    );
  }
  {
    const literal = extractFromSource(
      "s.tsx",
      'const p = "Paste it here, e.g.\\nAddress: 123 Main St, Unit 4\\nRent: 1950 a month";\n',
    );
    const found = literal.find((c) => c.text.startsWith("Paste it here"));
    ok("string literal candidate is found", Boolean(found));
    ok("string literal keeps its line breaks", (found?.text ?? "").includes("\n"));
    eq(
      "string literal sample is measured per line",
      tooLongSentences(found?.text ?? "").length,
      0,
    );
  }
}

/**
 * A gate whose file list is hand written goes blind the day someone adds a file.
 * Rather than ask a human to classify every new module, sweep the syndication
 * folders and fail on any ungated file that actually breaks the contract.
 */
function assertSurfaceCoverage() {
  const gated = new Set(SURFACES.map((s) => s.file));
  const unreadable: string[] = [];
  const carriers: { file: string; findings: number; sample: string }[] = [];

  const candidates: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > DISCOVERY_MAX_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(resolve(ROOT, dir), { withFileTypes: true });
    } catch {
      failed++;
      console.error(`  x discovery directory missing: ${dir}`);
      return;
    }
    for (const entry of entries) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(rel, depth + 1);
      } else if (/\.tsx?$/.test(entry.name)) {
        candidates.push(rel);
      }
    }
  };
  walk(DISCOVERY_ROOT, 0);
  for (const name of readdirSync(resolve(ROOT, "lib"))) {
    if (!name.endsWith(".ts")) continue;
    if (!DISCOVERY_LIB_PREFIXES.some((p) => name.startsWith(p))) continue;
    candidates.push(`lib/${name}`);
  }

  const duplicates: string[] = [];
  for (const file of candidates) {
    if (gated.has(file) || file in OUT_OF_SCOPE || file in BEING_REMOVED) continue;
    if (Object.keys(OUT_OF_SCOPE_DIRS).some((d) => file.startsWith(`${d}/`))) continue;
    if (isDuplicateArtifact(file)) {
      duplicates.push(file);
      continue;
    }
    let code: string;
    try {
      code = readFileSync(resolve(ROOT, file), "utf8");
    } catch {
      unreadable.push(file);
      continue;
    }
    let count = 0;
    let sample = "";
    for (const candidate of extractFromSource(file, code)) {
      const found = checkPlainLanguage(candidate.text);
      if (found.length && !sample) sample = candidate.text;
      count += found.length;
    }
    if (count > 0) carriers.push({ file, findings: count, sample });
  }

  ok("no ungated file carries landlord copy that breaks the contract", carriers.length === 0);
  for (const c of carriers) {
    console.error(`    ungated: ${c.file} (${c.findings} violations, e.g. ${JSON.stringify(c.sample.slice(0, 90))})`);
    console.error("    add it to SURFACES, or to OUT_OF_SCOPE with the reason");
  }
  if (duplicates.length) {
    console.log(
      `note: ${duplicates.length} duplicate file(s) skipped, copies rather than routes: ${duplicates.join(", ")}`,
    );
  }
  if (unreadable.length) {
    console.log(
      `note: ${unreadable.length} file(s) in the syndication folders could not be read and were skipped: ${unreadable.join(", ")}`,
    );
  }

  for (const file of Object.keys(OUT_OF_SCOPE)) {
    ok(`excused file is not also gated: ${file}`, !gated.has(file));
    ok(`excused file still exists: ${file}`, existsSync(resolve(ROOT, file)));
  }
  for (const file of Object.keys(BEING_REMOVED)) {
    ok(`file being removed is not also gated: ${file}`, !gated.has(file));
    ok(`file being removed is not also excused: ${file}`, !(file in OUT_OF_SCOPE));
    const stillThere = existsSync(resolve(ROOT, file));
    ok(`file being removed has an entry only while it exists: ${file}`, stillThere);
    if (!stillThere) console.error("    it is gone: delete its BEING_REMOVED entry");
  }
  // The deletion checklist: every source file, gated or not, that still imports
  // a module being removed. Wider than the gate on purpose: the gate reads copy,
  // the deletion has to find every caller.
  const everything: string[] = [];
  const walkAll = (dir: string, depth: number) => {
    if (depth > DISCOVERY_MAX_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(resolve(ROOT, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walkAll(rel, depth + 1);
      } else if (/\.tsx?$/.test(entry.name) && !isDuplicateArtifact(entry.name)) {
        everything.push(rel);
      }
    }
  };
  for (const top of ["app", "lib", "components"]) walkAll(top, 0);
  const stillImported = survivorsImportingRemoved(
    everything.filter((f) => !(f in BEING_REMOVED)),
    Object.keys(BEING_REMOVED),
    (f) => readFileSync(resolve(ROOT, f), "utf8"),
  );
  if (stillImported.length) {
    console.log(`note: ${stillImported.length} file(s) still import a module being removed (the deletion checklist):`);
    for (const row of stillImported) console.log(`      ${row.file} -> ${row.imports.join(", ")}`);
  }
  for (const dir of Object.keys(OUT_OF_SCOPE_DIRS)) {
    ok(`excused directory still exists: ${dir}`, existsSync(resolve(ROOT, dir)));
    const shadowed = SURFACES.map((s) => s.file).filter((f) => f.startsWith(`${dir}/`));
    ok(`excused directory does not shadow a gated file: ${dir}`, shadowed.length === 0);
  }
}

// --- the scan -----------------------------------------------------------------

type Located = PlainLanguageFinding & { file: string; where: string };

function scanSurfaces(): { findings: Located[]; strings: number; perSurface: Record<string, number> } {
  const findings: Located[] = [];
  const perSurface: Record<string, number> = {};
  let strings = 0;
  const catalogs: Record<string, { key: string; text: string }[]> = {};

  for (const surface of SURFACES) {
    const path = resolve(ROOT, surface.file);
    let code: string;
    try {
      code = readFileSync(path, "utf8");
    } catch {
      failed++;
      console.error(
        `  x surface missing: ${surface.file} (a renamed file must be re-listed, never dropped)`,
      );
      continue;
    }

    if (surface.mode === "json") {
      const entries = flattenJson(JSON.parse(code)).filter((e) => !e.key.startsWith("_note"));
      catalogs[surface.file] = entries;
      for (const entry of entries) {
        strings++;
        perSurface[surface.file] = (perSurface[surface.file] ?? 0) + 1;
        for (const finding of checkPlainLanguage(entry.text)) {
          findings.push({ ...finding, file: surface.file, where: entry.key });
        }
      }
      continue;
    }

    const candidates = extractFromSource(surface.file, code);
    for (const candidate of candidates) {
      strings++;
      perSurface[surface.file] = (perSurface[surface.file] ?? 0) + 1;
      for (const finding of checkPlainLanguage(candidate.text)) {
        findings.push({ ...finding, file: candidate.file, where: candidate.where });
      }
    }
  }

  for (const finding of catalogParityFindings(
    catalogs["messages/en.json"] ?? [],
    catalogs["messages/fr.json"] ?? [],
  )) {
    findings.push({ ...finding, file: "messages/fr.json", where: finding.text });
  }

  return { findings, strings, perSurface };
}

// --- baseline -----------------------------------------------------------------

// The baseline records, PER FILE, how many times each offender appears. Per file
// and counted, both on purpose:
//   - without a count, any of the known-bad strings could be pasted into new
//     code for free;
//   - without the file, a banned phrase could be MOVED from an advanced panel
//     onto the first-run card and the totals would not budge.
type BaselineEntry = { rule: PlainLanguageRule; file: string; text: string; count: number };
type Baseline = {
  version: number;
  note: string;
  generated: string;
  /** sha256 of the canonical entry list. Catches a careless hand edit, not a determined one. */
  checksum: string;
  /** Every file the gate covered when this baseline was written. */
  surfaces: string[];
  /**
   * THE ENFORCEMENT RECORD: how many violations of each rule each file is
   * allowed. Kept separately from `entries` because `entries` is a list of exact
   * strings, and a reworded string is simply absent from it. Deriving the
   * allowance from `entries` therefore dropped it below reality the moment any
   * copy changed, and the next run failed on copy that had just been improved.
   */
  totals: Record<string, number>;
  /**
   * How many copy strings each surface yielded. A file that reads and parses but
   * suddenly yields far fewer strings (a truncation, a half-finished merge, an
   * unterminated literal) is BLIND, not improved: without this the pawl would
   * tighten its allowance away and then fail the innocent commit that restores
   * the file.
   */
  strings: Record<string, number>;
  /** The worklist: which exact strings, and how many times each. */
  entries: BaselineEntry[];
};

const EMPTY_BASELINE: Baseline = {
  version: 4,
  note: "",
  generated: "",
  checksum: "",
  surfaces: [],
  totals: {},
  strings: {},
  entries: [],
};

export function fingerprint(f: { rule: PlainLanguageRule; file: string; text: string }): string {
  return `${f.rule}\u0000${f.file}\u0000${f.text}`;
}

export function checksumOf(entries: BaselineEntry[], totals: Record<string, number> = {}): string {
  const canonical = [
    ...entries.map((e) => `E ${e.rule}\u0000${e.file}\u0000${e.text}\u0000${e.count}`),
    ...Object.entries(totals).map(([k, v]) => `T ${k}\u0000${v}`),
  ]
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

export function countByFingerprint(
  findings: { rule: PlainLanguageRule; file: string; text: string }[],
): Map<string, BaselineEntry> {
  const counts = new Map<string, BaselineEntry>();
  for (const f of findings) {
    const key = fingerprint(f);
    const seen = counts.get(key);
    if (seen) seen.count += 1;
    else counts.set(key, { rule: f.rule, file: f.file, text: f.text, count: 1 });
  }
  return counts;
}

export type Excess = { rule: PlainLanguageRule; file: string; was: number; now: number };

/**
 * Enforcement counts violations PER FILE PER RULE, not per exact string.
 *
 * Per file, so a banned phrase cannot be MOVED from an advanced panel onto the
 * first-run card while the totals stay flat. Not per exact string, because every
 * edit changes the string: a developer who shortens a 20 word sentence but has
 * not yet removed its banned word would otherwise be told they had invented a
 * brand new offender, and the only way to a green gate would be to fix every
 * violation in a string at once or revert. The exact strings are still recorded,
 * as the worklist and so the ratchet can tighten, but they are not the metric.
 */
export function countByFileRule(
  items: { rule: PlainLanguageRule; file: string; count?: number }[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of items) {
    const key = `${item.file}\u0000${item.rule}`;
    totals.set(key, (totals.get(key) ?? 0) + (item.count ?? 1));
  }
  return totals;
}

/** What got worse, and what got better, between a baseline and a run. */
export function compareToBaseline(
  findings: { rule: PlainLanguageRule; file: string; text: string }[],
  baseline: { totals: Record<string, number>; entries: BaselineEntry[] },
): {
  excess: Excess[];
  improved: (BaselineEntry & { now: number })[];
  improvedOccurrences: number;
} {
  const now = countByFileRule(findings);
  const was = new Map(Object.entries(baseline.totals ?? {}));

  const excess: Excess[] = [];
  for (const [key, count] of now) {
    const before = was.get(key) ?? 0;
    if (count > before) {
      const [file, rule] = key.split("\u0000");
      excess.push({ rule: rule as PlainLanguageRule, file, was: before, now: count });
    }
  }

  const current = countByFingerprint(findings);
  const improved = (baseline.entries ?? [])
    .map((e) => ({ ...e, now: current.get(fingerprint(e))?.count ?? 0 }))
    .filter((e) => e.now < e.count);

  let improvedOccurrences = 0;
  for (const [key, count] of was) {
    const after = now.get(key) ?? 0;
    if (after < count) improvedOccurrences += count - after;
  }

  return { excess, improved, improvedOccurrences };
}

/** How far a surface's string count may fall before it reads as blindness. */
export const STRING_COUNT_FLOOR = 0.7;

/** Surfaces that yield far fewer strings than the baseline recorded. */
export function shrunkSurfaces(
  was: Record<string, number>,
  now: Record<string, number>,
): { file: string; was: number; now: number }[] {
  const out: { file: string; was: number; now: number }[] = [];
  for (const [file, count] of Object.entries(was)) {
    if (count <= 0) continue;
    const after = now[file] ?? 0;
    if (after < count * STRING_COUNT_FLOOR) out.push({ file, was: count, now: after });
  }
  return out;
}

/** True when the recorded checksum does not match the content it covers. */
export function baselineIsTampered(parsed: {
  checksum?: string;
  entries?: BaselineEntry[];
  totals?: Record<string, number>;
}): boolean {
  return checksumOf(parsed.entries ?? [], parsed.totals ?? {}) !== parsed.checksum;
}

/** True when the run found fewer violations than the caller said to expect. */
export function belowFloor(found: number, min: number | null): boolean {
  return min !== null && found < min;
}

/** Files the baseline was written against that are no longer under the gate. */
export function droppedSurfaces(baselineSurfaces: string[], gatedNow: string[]): string[] {
  const now = new Set(gatedNow);
  return baselineSurfaces.filter((f) => !now.has(f));
}

/**
 * Which files still import a module on the BEING_REMOVED list. Printed as
 * a note, never a failure: it is the deletion checklist, and it goes quiet on
 * its own as the self-guided path is cut out.
 */
export function survivorsImportingRemoved(
  survivors: string[],
  removed: string[],
  read: (file: string) => string,
): { file: string; imports: string[] }[] {
  const out: { file: string; imports: string[] }[] = [];
  const stems = removed.map((r) => r.replace(/\.tsx?$/, ""));
  for (const file of survivors) {
    let code: string;
    try {
      code = read(file);
    } catch {
      continue;
    }
    const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
    const hits = new Set<string>();
    for (const m of code.matchAll(/from\s+["']([^"']+)["']/g)) {
      const spec = m[1];
      let target: string | null = null;
      if (spec.startsWith("@/")) target = spec.slice(2);
      else if (spec.startsWith("./") || spec.startsWith("../")) {
        const parts = `${dir}/${spec}`.split("/");
        const norm: string[] = [];
        for (const p of parts) {
          if (p === "." || p === "") continue;
          if (p === "..") norm.pop();
          else norm.push(p);
        }
        target = norm.join("/");
      }
      if (!target) continue;
      const i = stems.indexOf(target);
      if (i >= 0) hits.add(removed[i]);
    }
    if (hits.size) out.push({ file, imports: [...hits].sort() });
  }
  return out;
}

/** The pawl fires on cause, never on size: no excess, no failure, no dropped surface. */
export function shouldTighten(input: {
  excess: number;
  failed: number;
  dropped: number;
  improved: number;
}): boolean {
  return input.excess === 0 && input.failed === 0 && input.dropped === 0 && input.improved > 0;
}

/** The worklist, pulled down to what the code now holds. Entries that are gone drop out. */
export function tightenedEntries(
  current: Map<string, BaselineEntry>,
  entries: BaselineEntry[],
): BaselineEntry[] {
  return entries
    .map((e) => ({ ...e, count: Math.min(e.count, current.get(fingerprint(e))?.count ?? 0) }))
    .filter((e) => e.count > 0);
}

/** The allowance, pulled down to what the code now holds. It can only decrease. */
export function tightenedTotals(
  findings: { rule: PlainLanguageRule; file: string; text: string }[],
  totals: Record<string, number>,
): Record<string, number> {
  const now = countByFileRule(findings);
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(totals)) {
    const after = Math.min(count, now.get(key) ?? 0);
    if (after > 0) out[key] = after;
  }
  return out;
}

function sortEntries(entries: BaselineEntry[]): BaselineEntry[] {
  return [...entries].sort((a, b) =>
    a.file !== b.file
      ? a.file.localeCompare(b.file)
      : a.rule !== b.rule
        ? a.rule.localeCompare(b.rule)
        : a.text.localeCompare(b.text),
  );
}

function readBaseline(): { baseline: Baseline; tampered: boolean; missing: boolean } {
  let raw: string;
  try {
    raw = readFileSync(BASELINE_PATH, "utf8");
  } catch {
    return { baseline: EMPTY_BASELINE, tampered: false, missing: true };
  }
  const parsed = JSON.parse(raw) as Baseline;
  const entries = (parsed.entries ?? []).map((e) => ({ ...e, count: e.count ?? 1 }));
  const totals = parsed.totals ?? {};
  const baseline = { ...EMPTY_BASELINE, ...parsed, entries, totals };
  return { baseline, tampered: baselineIsTampered(parsed), missing: false };
}

function persistBaseline(
  entries: BaselineEntry[],
  totals: Record<string, number>,
  strings: Record<string, number>,
  note: string,
) {
  const sorted = sortEntries(entries);
  const orderedTotals: Record<string, number> = {};
  for (const key of Object.keys(totals).sort()) orderedTotals[key] = totals[key];
  const baseline: Baseline = {
    version: 4,
    note,
    generated: new Date().toISOString().slice(0, 10),
    checksum: checksumOf(sorted, orderedTotals),
    surfaces: SURFACES.map((s) => s.file).sort(),
    totals: orderedTotals,
    strings: Object.fromEntries(Object.keys(strings).sort().map((k) => [k, strings[k]])),
    entries: sorted,
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
}

const BASELINE_NOTE =
  "Copy that already breaks the word contract, per file, with how many times each string appears. The gate fails when any of these gets more frequent, or when a new one appears, and tightens itself whenever copy improves. Written by scripts/test-plain-language.ts only: a hand edit fails the checksum.";

function writeBaseline(findings: Located[], perSurface: Record<string, number>) {
  const entries = sortEntries([...countByFingerprint(findings).values()]);
  const totals = Object.fromEntries(countByFileRule(findings));
  persistBaseline(entries, totals, perSurface, BASELINE_NOTE);
  const total = Object.values(totals).reduce((n, v) => n + v, 0);
  console.log(`baseline written: ${entries.length} distinct strings, ${total} violations allowed`);
}

// --- main ---------------------------------------------------------------------
// Guarded so the extractor above can be imported by another script without
// running the gate as a side effect.

function main() {
const argv = process.argv.slice(2);
const strict = argv.includes("--strict");
const report = argv.includes("--report");
const update = argv.includes("--update-baseline");
const acceptNew = argv.includes("--accept-new");
const regenerateDoc = argv.includes("--regenerate-doc");
const minArg = argv.find((a) => a.startsWith("--min-offenders="));
const minOffenders = minArg ? Number(minArg.split("=")[1]) : null;

runSeededAssertions();
assertSurfaceCoverage();

// The generated table must match the module, so the doc can never drift.
// Regenerating the doc is its OWN flag: when it shared a flag with the baseline
// update, fixing a typo in the table quietly absorbed every new offender.
const wantMarkdown = plainWordsMarkdown();
if (regenerateDoc) {
  writeFileSync(MARKDOWN_PATH, wantMarkdown, "utf8");
  console.log("lib/i18n/plain-words.md regenerated");
} else {
  let haveMarkdown = "";
  try {
    haveMarkdown = readFileSync(MARKDOWN_PATH, "utf8");
  } catch {
    haveMarkdown = "";
  }
  ok("lib/i18n/plain-words.md matches lib/i18n/plain-words.ts", haveMarkdown === wantMarkdown);
  if (haveMarkdown !== wantMarkdown) {
    console.error("    run: npm run test:plain-language -- --regenerate-doc");
  }
}

const { findings, strings, perSurface } = scanSurfaces();
const before = readBaseline();

// A hand edited baseline is one way to launder bad copy past the ratchet, so it
// is refused everywhere, including inside --update-baseline (which would
// otherwise re-bless the edit by comparing against it).
if (before.tampered && !before.missing) {
  if (update && acceptNew) {
    console.log("--accept-new: rewriting a baseline whose checksum did not match.");
  } else {
    failed++;
    console.error("  x scripts/plain-language-baseline.json does not match its checksum");
    console.error("    it is written by this script only; revert the hand edit and re-run");
    if (update) {
      console.error("    (deliberate rebuild: re-run with --accept-new)");
      process.exit(1);
    }
  }
}

// A gate that quietly stops looking at a file is worse than no gate. Every file
// the baseline was written against must still be under the gate.
const gatedNow = new Set(SURFACES.map((s) => s.file));
const dropped = droppedSurfaces(before.baseline.surfaces ?? [], [...gatedNow]);
if (dropped.length && !(update && acceptNew)) {
  failed++;
  console.error("  x surfaces the baseline covers are no longer gated:");
  for (const f of dropped) console.error(`      ${f}`);
  console.error("    put them back in SURFACES, or re-run --update-baseline --accept-new");
}

// A surface that reads and parses but yields far fewer strings is blind, not
// improved. This has to be a hard failure BEFORE the pawl, or a truncated file
// tightens its own allowance away and the commit that restores it fails.
const shrunk = shrunkSurfaces(before.baseline.strings ?? {}, perSurface);
if (shrunk.length && !(update && acceptNew)) {
  failed++;
  console.error("  x surfaces yield far fewer copy strings than the baseline recorded:");
  for (const surface of shrunk.slice(0, 10)) {
    console.error(`      ${surface.file}: was ${surface.was}, now ${surface.now}`);
  }
  console.error("    a truncated or half-merged file looks exactly like this; check it before");
  console.error("    re-running with --update-baseline");
}

const { excess, improved, improvedOccurrences } = compareToBaseline(findings, before.baseline);

if (update) {
  if (excess.length && !acceptNew) {
    console.error("");
    console.error("REFUSED: --update-baseline will not record copy that is new or more frequent.");
    console.error("Fix the copy. If this really is a deliberate exception, re-run with --accept-new.");
    for (const e of excess.slice(0, 20)) {
      console.error(`  [${e.rule}] ${e.file}: was ${e.was}, now ${e.now}`);
    }
    if (excess.length > 20) console.error(`  ... and ${excess.length - 20} more`);
    process.exit(1);
  }
  if (excess.length && acceptNew) {
    console.log("");
    console.log(`--accept-new: recording ${excess.length} new or more frequent offenders.`);
    for (const e of excess.slice(0, 20)) {
      console.log(`  [${e.rule}] ${e.file}: was ${e.was}, now ${e.now}`);
    }
  }
  writeBaseline(findings, perSurface);
  console.log(`${passed} assertions passed, ${failed} failed`);
  if (failed > 0) {
    console.error("FAIL: the baseline was written but assertions failed above.");
    process.exit(1);
  }
  console.log("Baseline updated. The gate now measures against this run.");
  process.exit(0);
}

const baselineTotal = Object.values(before.baseline.totals ?? {}).reduce((n, v) => n + v, 0);

const byRule = new Map<PlainLanguageRule, number>();
for (const f of findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);

console.log("");
console.log(`scanned ${strings} strings across ${SURFACES.length} surfaces`);
for (const rule of PLAIN_LANGUAGE_RULES) {
  const n = byRule.get(rule) ?? 0;
  if (n) console.log(`  ${rule.padEnd(20)} ${n}`);
}
console.log(
  `offenders: ${findings.length}   baseline: ${baselineTotal}   new or worse: ${excess.length}   improved: ${improved.length}`,
);

function print(list: Located[], limit: number) {
  for (const f of list.slice(0, limit)) {
    console.log(`  [${f.rule}] ${f.file} ${f.where}`);
    console.log(`      ${JSON.stringify(f.text.slice(0, 160))}`);
    console.log(`      ${f.detail}`);
  }
  if (list.length > limit) console.log(`  ... and ${list.length - limit} more`);
}

if (report) {
  console.log("");
  print(findings, findings.length);
  console.log(`\n${passed} assertions passed, ${failed} failed (report mode, not a gate)`);
  process.exit(failed > 0 ? 1 : 0);
}

if (strict) {
  console.log("");
  if (findings.length) {
    console.log("STRICT: every offender below must be gone for the copy sweep to be accepted.");
    print(findings, 40);
  }
  console.log(`\n${passed} assertions passed, ${failed} failed`);
  if (failed > 0 || findings.length > 0) {
    console.error(`\nSTRICT FAIL: ${findings.length} offenders still in the copy.`);
    process.exit(1);
  }
  console.log("STRICT PASS: the word contract holds everywhere.");
  process.exit(0);
}

if (excess.length) {
  const known = new Set(before.baseline.entries.map(fingerprint));
  const fresh = findings.filter(
    (f) =>
      excess.some((e) => e.rule === f.rule && e.file === f.file) && !known.has(fingerprint(f)),
  );
  console.log("");
  console.log("MORE violations than the baseline records. Fix the copy; it will not be recorded:");
  for (const e of excess.slice(0, 20)) {
    console.log(`  ${e.file}  ${e.rule}: was ${e.was}, now ${e.now}`);
  }
  if (excess.length > 20) console.log(`  ... and ${excess.length - 20} more`);
  if (fresh.length) {
    console.log("");
    console.log("Strings in those files the baseline has not seen before:");
    print(fresh, 25);
  }
}

// An optional explicit floor, for a caller that knows roughly what to expect.
if (belowFloor(findings.length, minOffenders)) {
  failed++;
  console.error(
    `  x only ${findings.length} offenders found, expected at least ${minOffenders}`,
  );
  console.error("    the scanner has probably stopped seeing a surface; check SURFACES");
}

// THE PAWL. Improved copy is never a failure, but it must tighten the baseline
// in the same run, or the old count stays as a standing credit and the phrase
// you just deleted can be pasted back tomorrow for free.
//
// It tightens on CAUSE, not on size. A first attempt refused to tighten when the
// drop was large, to stop a broken scanner from destroying the record; but a
// large drop is exactly what a real work package produces, so the pawl was off
// for every commit that mattered. The blindness cases are already hard failures
// before this point: a surface dropped from SURFACES, a surface that will not
// read, or any seeded assertion going red. So if none of those fired, a smaller
// number is real progress and the baseline follows it down.
const removedOccurrences = improvedOccurrences;
let tightened = false;
// improvedOccurrences, not improved.length: the pawl lowers `totals`, so it must
// be triggered by a fall in `totals`. Keyed on the worklist instead, a reword
// pruned an entry, printed "0 fewer occurrences", left the allowance untouched,
// and the real removal that followed could never tighten it again.
if (
  shouldTighten({
    excess: excess.length,
    failed,
    dropped: dropped.length,
    improved: improvedOccurrences,
  })
) {
  persistBaseline(
    tightenedEntries(countByFingerprint(findings), before.baseline.entries),
    tightenedTotals(findings, before.baseline.totals ?? {}),
    perSurface,
    BASELINE_NOTE,
  );
  tightened = true;
  console.log("");
  console.log(
    `ratchet tightened: ${removedOccurrences} fewer occurrences across ${improved.length} entries. Commit scripts/plain-language-baseline.json with your copy change.`,
  );
}

console.log(`\n${passed} assertions passed, ${failed} failed`);
if (failed > 0 || excess.length > 0) {
  console.error(`\nFAIL: ${failed} assertion failures, ${excess.length} new or worse offenders.`);
  process.exit(1);
}
const remaining = tightened ? baselineTotal - removedOccurrences : baselineTotal;
console.log(
  `PASS: nothing got worse. ${remaining} known offenders left for the copy sweep (--strict lists them).`,
);
}

if (require.main === module) main();
