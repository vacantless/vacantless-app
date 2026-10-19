// scripts/test-address-merge.ts (S724, V251-03). Run: tsx scripts/test-address-merge.ts
import { findUnit, findPostalCode, mergeAddressSuggestion } from "@/lib/address-merge";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, got?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL ${name}`, got === undefined ? "" : JSON.stringify(got));
  }
}

ok("suite word", findUnit("251 Manitoba St, Suite 124")?.value === "124");
ok("unit word", findUnit("833 Pillette Rd Unit 3, Windsor")?.word === "Unit");
ok("apt", findUnit("10 King St Apt 5B")?.word === "Apt");
ok("hash", findUnit("10 King St #12")?.value === "12");
ok("leading", findUnit("124-251 Manitoba St")?.value === "124");
ok("no unit", findUnit("100 Lakeview Ave, Windsor, ON") === null);
ok("postal", findPostalCode("Toronto, ON m8y0c7") === "M8Y 0C7");

const m1 = mergeAddressSuggestion(
  "251 Manitoba St, Suite 124, Toronto, ON M8Y 0C7",
  "251 Manitoba St, Toronto, ON M8Y 4G6, Canada",
);
ok("keeps suite", m1.address.startsWith("251 Manitoba St, Suite 124, Toronto"), m1.address);
ok("keeps typed postal", m1.address.includes("M8Y 0C7") && !m1.address.includes("4G6"), m1.address);
ok("flags conflict", m1.postalConflict?.suggested === "M8Y 4G6", m1.postalConflict);

const m2 = mergeAddressSuggestion("251 Manitoba St Suite 124", "251 Manitoba St, Toronto, ON");
ok("no postal typed: suite only", m2.address === "251 Manitoba St, Suite 124, Toronto, ON", m2.address);
ok("no conflict", m2.postalConflict === null);

const m3 = mergeAddressSuggestion("100 Lakeview", "100 Lakeview Ave, Windsor, ON N8Y 1A1");
ok("plain pick unchanged", m3.address === "100 Lakeview Ave, Windsor, ON N8Y 1A1", m3.address);

const m4 = mergeAddressSuggestion("Unit 3 833 Pillette", "833 Pillette Rd Unit 3, Windsor, ON");
ok("no double unit", m4.address === "833 Pillette Rd Unit 3, Windsor, ON" && m4.keptUnit === null, m4.address);

const m5 = mergeAddressSuggestion("124-251 Manitoba St", "251 Manitoba St, Toronto, ON");
ok("leading unit kept", m5.address === "251 Manitoba St, Unit 124, Toronto, ON", m5.address);

const m6 = mergeAddressSuggestion("251 Manitoba St M8Y 0C7", "251 Manitoba St, Toronto, ON");
ok("typed postal appended", m6.address.endsWith("M8Y 0C7"), m6.address);

console.log(`address-merge: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
