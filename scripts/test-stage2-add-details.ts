import {
  STAGE2_METHODS,
  stage2FieldStatusKey,
  toStage2Preview,
} from "../lib/stage2-add-details";
import type { IntakePreview } from "../lib/intake-preview";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

ok("three intake methods", STAGE2_METHODS.length === 3);
ok(
  "methods are email/document/manual in order",
  STAGE2_METHODS.map((m) => m.id).join(",") === "email,document,manual",
);
ok("email routes to captures", STAGE2_METHODS[0].href === "/dashboard/captures");
ok(
  "document routes to properties",
  STAGE2_METHODS[1].href === "/dashboard/properties",
);
ok(
  "manual routes to properties",
  STAGE2_METHODS[2].href === "/dashboard/properties",
);
ok(
  "every method carries a title + body key",
  STAGE2_METHODS.every((m) => Boolean(m.titleKey) && Boolean(m.bodyKey)),
);

ok("found -> found key", stage2FieldStatusKey(true) === "found");
ok("not found -> pleaseCheck key", stage2FieldStatusKey(false) === "pleaseCheck");

ok(
  "null preview -> empty, no source",
  (() => {
    const p = toStage2Preview(null);
    return (
      p.hasSource === false &&
      p.rows.length === 0 &&
      p.publicDescription === null
    );
  })(),
);

const sample: IntakePreview = {
  sourceKind: "mls",
  publicDescription: "Bright unit near transit.",
  fields: [
    { label: "Address", value: "50 Glenrose Ave", found: true },
    { label: "Rent", value: "$2,150", found: true },
  ],
};
ok(
  "preview passes rows + description through",
  (() => {
    const p = toStage2Preview(sample);
    return (
      p.hasSource === true &&
      p.rows.length === 2 &&
      p.publicDescription === "Bright unit near transit."
    );
  })(),
);

console.log(`\nstage2-add-details: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
