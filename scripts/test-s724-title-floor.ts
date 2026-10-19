// scripts/test-s724-title-floor.ts (V251-06). Run: tsx scripts/test-s724-title-floor.ts
import { extractLeadDescriptors } from "@/lib/listing-copy";
let pass = 0, fail = 0;
function eq(name: string, got: string[], want: string[]) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.error(`FAIL ${name}`, got, "want", want); }
}
eq("powder room is a room", extractLeadDescriptors("Bright two-storey suite with a main-floor powder room."), ["Bright"]);
eq("main floor bath", extractLeadDescriptors("Spacious home, main floor bathroom and laundry."), ["Spacious"]);
eq("townhouse skips floor", extractLeadDescriptors("Modern condo townhouse, main floor living."), ["Modern"]);
eq("real main-floor unit", extractLeadDescriptors("Bright main-floor 1 bedroom apartment."), ["Bright", "Main-Floor"]);
eq("main floor unit", extractLeadDescriptors("Quiet main floor unit near transit."), ["Main-Floor", "Quiet"]);
eq("top floor loft", extractLeadDescriptors("Sunny unit with top floor loft space."), ["Sunny"]);
eq("top floor apartment", extractLeadDescriptors("Top floor apartment, renovated."), ["Renovated", "Top-Floor"]);
console.log(`s724-title-floor: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
