// Bundle guard (SPEC-S688 acceptance 4): no client module may import the
// session decryptor, the session-status writer, or the service-role client.
// Walks app/ and components/ for "use client" files (plus any *client*.tsx)
// and fails on a static import of a forbidden module.
// Run: npx tsx scripts/test-no-client-secret-imports.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");
const SCAN_DIRS = ["app", "components"];
const FORBIDDEN = [
  "lib/distribution-session-crypto",
  "lib/distribution-session-status",
  "lib/supabase/admin",
];

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(full);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d), []));
let clientFiles = 0;
const offenders: string[] = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const head = src.slice(0, 400);
  const isClient = /^\s*["']use client["']/m.test(head) || /client\.tsx?$/.test(file);
  if (!isClient) continue;
  clientFiles++;
  for (const mod of FORBIDDEN) {
    const re = new RegExp(`from\\s+["'](?:@/|\\.{1,2}/(?:\\.\\./)*)?${mod.replace(/\//g, "\\/")}["']`);
    if (re.test(src)) offenders.push(`${relative(ROOT, file)} imports ${mod}`);
  }
}

for (const o of offenders) console.error(`  x ${o}`);
console.log(
  `\nno-client-secret-imports: ${clientFiles} client modules scanned, ${offenders.length} offenders`,
);
if (clientFiles === 0) {
  console.error("  x no client modules found; the scan is broken");
  process.exit(1);
}
if (offenders.length > 0) process.exit(1);
