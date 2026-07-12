import assert from "node:assert";
import { resolveArrivalPhone } from "../lib/showing-contact";

let pass = 0, fail = 0;
const t = (n: string, fn: () => void) => {
  try { fn(); pass++; } catch (e) { fail++; console.error("FAIL", n, (e as Error).message); }
};

t("property override wins", () => assert.strictEqual(resolveArrivalPhone("P", "O", "X"), "P"));
t("org default when no property", () => assert.strictEqual(resolveArrivalPhone(null, "O", "X"), "O"));
t("public fallback when property+org empty", () => assert.strictEqual(resolveArrivalPhone("  ", "", "X"), "X"));
t("null when all empty/nullish", () => assert.strictEqual(resolveArrivalPhone("", null, undefined), null));
t("whitespace treated as empty", () => assert.strictEqual(resolveArrivalPhone("   ", "  ", "  "), null));
t("trims but preserves operator formatting", () => assert.strictEqual(resolveArrivalPhone(" (226) 778-0014 ", null, null), "(226) 778-0014"));

console.log(`test-showing-contact: ${pass}/${fail}`);
if (fail) process.exit(1);
