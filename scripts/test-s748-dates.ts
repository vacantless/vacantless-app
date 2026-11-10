// S748: server-rendered dates name a time zone. Pages run in UTC on Vercel,
// so a date formatted with none shows the next day for evening events.
// Run: npx tsx scripts/test-s748-dates.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_TIME_ZONE, displayTimeZone } from "../lib/dates";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
    if (extra !== undefined) console.error("    ->", JSON.stringify(extra));
  }
}

ok("default is Toronto", DEFAULT_TIME_ZONE === "America/Toronto");
ok("keeps a real zone", displayTimeZone("America/Vancouver") === "America/Vancouver");
ok("bad zone falls back", displayTimeZone("Mars/Base") === DEFAULT_TIME_ZONE);
ok("empty falls back", displayTimeZone(null) === DEFAULT_TIME_ZONE && displayTimeZone("") === DEFAULT_TIME_ZONE);

// Dates built from plain parts (new Date(y, m, d), Date.UTC, `${iso}T00:00:00`)
// are created and formatted in the same zone, so they show the right day.
// Those are recognised by their text below, so an edit above them that moves
// the line does not break the check (S748f: a line-number list went red when
// S748d added four lines to the reconcile page).
const PLAIN_PARTS = /new Date\((?:[^()]*,[^()]*|`\$\{[^`]*\}T00:00:00`)\)\s*$/;
const ALLOWED = new Set([
  "app/r/[propertyId]/page.tsx:403", // S775: +1 line (group-viewing import)
  "app/dashboard/automations/page.tsx:121",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.bak|fuse_hidden/.test(name)) out.push(p);
  }
  return out;
}

const offenders: string[] = [];
for (const f of [...walk("app"), ...walk("lib"), ...walk("components")]) {
  const s = readFileSync(f, "utf8");
  if (/^\s*["']use client["']/.test(s)) continue; // runs in the viewer's own zone
  const re = /\.(toLocaleDateString|toLocaleTimeString|toLocaleString)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    let depth = 1;
    let j = m.index + m[0].length;
    while (j < s.length && depth > 0) {
      if (s[j] === "(") depth++;
      else if (s[j] === ")") depth--;
      j++;
    }
    const args = s.slice(m.index + m[0].length, j - 1);
    if (/timeZone/.test(args)) continue;
    const before = s.slice(Math.max(0, m.index - 60), m.index);
    if (m[1] === "toLocaleString" && !/(Date|\bd|date|when|at)\)?\s*$/.test(before)) continue; // a number
    if (PLAIN_PARTS.test(before)) continue;
    if (/(cents|dollars|amount|safe)\s*(\/\s*100\s*\))?\s*$/.test(before)) continue;
    const line = s.slice(0, m.index).split("\n").length;
    const key = `${f}:${line}`;
    if (!ALLOWED.has(key)) offenders.push(key);
  }
}
ok("every server date names a time zone", offenders.length === 0, offenders);

console.log(`\ns748 dates: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
