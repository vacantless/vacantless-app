import assert from "node:assert";
import { resolveArrivalPhone, telDialString } from "../lib/showing-contact";

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

t("telDialString strips formatting", () => assert.strictEqual(telDialString("(226) 778-0014"), "2267780014"));
t("telDialString keeps leading +", () => assert.strictEqual(telDialString("+1 226-778-0014"), "+12267780014"));
t("telDialString pause-dials ext", () => assert.strictEqual(telDialString("226-778-0014 ext 5"), "2267780014,5"));
t("telDialString handles x ext", () => assert.strictEqual(telDialString("519-915-8865 x101"), "5199158865,101"));
t("telDialString handles # ext", () => assert.strictEqual(telDialString("519.915.8865 #12"), "5199158865,12"));
t("telDialString blank -> empty", () => assert.strictEqual(telDialString(""), ""));

console.log(`test-showing-contact: ${pass}/${fail}`);
if (fail) process.exit(1);
