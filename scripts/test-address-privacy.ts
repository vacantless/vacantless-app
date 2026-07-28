// Unit tests for public address masking helpers.
// Run: npx tsx scripts/test-address-privacy.ts
import { publicAddressLabel } from "../lib/address-privacy";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

ok(
  "full returns the stored address unchanged",
  publicAddressLabel({
    address: " 8 Sultan St, Unit 402, Toronto, ON ",
    city: "Toronto",
    mode: "full",
  }) === " 8 Sultan St, Unit 402, Toronto, ON ",
);

ok(
  "unknown mode returns the stored address unchanged",
  publicAddressLabel({
    address: "8 Sultan St, Unit 402, Toronto, ON",
    city: "Toronto",
    mode: undefined,
  }) === "8 Sultan St, Unit 402, Toronto, ON",
);

ok(
  "hide_unit removes embedded Unit fragment",
  publicAddressLabel({
    address: "8 Sultan St, Unit 402, Toronto, ON",
    city: "Toronto",
    mode: "hide_unit",
  }) === "8 Sultan St, Toronto, ON",
);

ok(
  "hide_unit removes leading Unit fragment",
  publicAddressLabel({
    address: "Unit 2, 10 Main St, Ottawa, ON",
    city: "Ottawa",
    mode: "hide_unit",
  }) === "10 Main St, Ottawa, ON",
);

ok(
  "hide_unit removes hash unit fragment",
  publicAddressLabel({
    address: "55 Bloor St W #812, Toronto, ON",
    city: "Toronto",
    mode: "hide_unit",
  }) === "55 Bloor St W, Toronto, ON",
);

ok(
  "hide_unit removes Suite fragment",
  publicAddressLabel({
    address: "220 Queen St W Suite 12B, Toronto, ON",
    city: "Toronto",
    mode: "hide_unit",
  }) === "220 Queen St W, Toronto, ON",
);

ok(
  "hide_unit keeps a unitless address",
  publicAddressLabel({
    address: "42 King St E, Hamilton, ON",
    city: "Hamilton",
    mode: "hide_unit",
  }) === "42 King St E, Hamilton, ON",
);

ok(
  "approximate removes unit and civic number",
  publicAddressLabel({
    address: "8 Sultan St, Unit 402, Toronto, ON",
    city: "Toronto",
    mode: "approximate",
  }) === "Sultan St, Toronto",
);

ok(
  "approximate handles hash unit",
  publicAddressLabel({
    address: "#12, 55 Bloor St W, Toronto, ON",
    city: "Toronto",
    mode: "approximate",
  }) === "Bloor St W, Toronto",
);

ok(
  "approximate handles unitless address",
  publicAddressLabel({
    address: "10 Main St, Ottawa, ON",
    city: "Ottawa",
    mode: "approximate",
  }) === "Main St, Ottawa",
);

ok(
  "approximate drops province and postal-code tail",
  publicAddressLabel({
    address: "22 Duke St, Kitchener, ON N2H 1A1, Canada",
    city: "Kitchener",
    mode: "approximate",
  }) === "Duke St, Kitchener",
);

ok(
  "approximate falls back to city when it cannot strip a civic number",
  publicAddressLabel({
    address: "Sultan St, Toronto, ON",
    city: "Toronto",
    mode: "approximate",
  }) === "Toronto",
);

ok(
  "approximate with no city and unsafe address returns nothing",
  publicAddressLabel({
    address: "Sultan St",
    city: null,
    mode: "approximate",
  }) === "",
);

ok(
  "null address falls back to city for masked modes",
  publicAddressLabel({
    address: null,
    city: "Toronto",
    mode: "hide_unit",
  }) === "Toronto",
);

ok(
  "null address and missing city returns blank",
  publicAddressLabel({
    address: null,
    city: null,
    mode: "approximate",
  }) === "",
);

console.log(`\naddress-privacy: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
