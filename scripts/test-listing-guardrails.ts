// Unit tests for the pure listing-guardrails logic.
// Run: npx tsx scripts/test-listing-guardrails.ts
import {
  GUARDRAIL_SEVERITIES,
  guardrailsForPortal,
  countBySeverity,
  hasCritical,
  severityLabel,
  type Guardrail,
} from "../lib/listing-guardrails";
import { PORTAL_KEYS } from "../lib/listing-distribution";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- severities ------------------------------------------------------------
ok("3 severities", GUARDRAIL_SEVERITIES.length === 3);
ok("severityLabel: critical", severityLabel("critical") === "Critical");
ok("severityLabel: warning", severityLabel("warning") === "Watch out");
ok("severityLabel: tip", severityLabel("tip") === "Tip");
ok("severityLabel: junk -> Tip", severityLabel("nope") === "Tip");

// --- every portal returns a usable checklist -------------------------------
for (const key of PORTAL_KEYS) {
  const list = guardrailsForPortal(key);
  ok(`${key}: non-empty (universal floor)`, list.length >= 3);
  // ids unique within the portal
  const ids = new Set(list.map((g) => g.id));
  ok(`${key}: ids unique`, ids.size === list.length);
  // every guardrail well-formed
  ok(
    `${key}: all fields present`,
    list.every(
      (g: Guardrail) =>
        !!g.id &&
        !!g.title &&
        !!g.detail &&
        GUARDRAIL_SEVERITIES.includes(g.severity),
    ),
  );
  // universal three always tail the list
  const tailIds = list.slice(-3).map((g) => g.id);
  ok(
    `${key}: universal tail present`,
    tailIds.includes("universal-disclosures") &&
      tailIds.includes("universal-exterior-photo") &&
      tailIds.includes("universal-tracked-link"),
  );
}

// --- portal-specific traps surface the documented gotchas ------------------
const kijiji = guardrailsForPortal("kijiji");
ok(
  "kijiji: location-lock present + critical",
  kijiji.some((g) => g.id === "kijiji-location-lock" && g.severity === "critical"),
);
ok(
  "kijiji: lite->plus reset present + critical",
  kijiji.some((g) => g.id === "kijiji-lite-plus-reset" && g.severity === "critical"),
);
ok("kijiji: has critical", hasCritical("kijiji"));

const rentals = guardrailsForPortal("rentals_ca");
ok(
  "rentals_ca: disabled-default present + critical",
  rentals.some((g) => g.id === "rentalsca-disabled-default" && g.severity === "critical"),
);
ok(
  "rentals_ca: lead-contact revert present",
  rentals.some((g) => g.id === "rentalsca-lead-contact-revert"),
);

const rentfaster = guardrailsForPortal("rentfaster");
ok(
  "rentfaster: paid 60-day guardrail present + critical",
  rentfaster.some((g) => g.id === "rentfaster-paid-sixty-day" && g.severity === "critical"),
);
ok(
  "rentfaster: single-address guardrail present",
  rentfaster.some((g) => g.id === "rentfaster-single-address"),
);

const fb = guardrailsForPortal("facebook");
ok(
  "facebook: manual-only present + critical",
  fb.some((g) => g.id === "facebook-manual-only" && g.severity === "critical"),
);

const viewit = guardrailsForPortal("viewit");
ok(
  "viewit: paid warning present + critical",
  viewit.some((g) => g.id === "viewit-paid-not-free" && g.severity === "critical"),
);

// realtor_ca + other have no money-trap criticals (only universal warnings/tips)
ok("realtor_ca: no critical", !hasCritical("realtor_ca"));
ok("other: no critical", !hasCritical("other"));

// --- sort order: the portal-specific prefix is critical → warning → tip ----
// (The 3 universal reminders are appended after, so they intentionally sit
// outside the portal-specific sort — exclude them before checking.)
function isSorted(list: ReadonlyArray<Guardrail>): boolean {
  const rank = { critical: 0, warning: 1, tip: 2 } as const;
  for (let i = 1; i < list.length; i++) {
    if (rank[list[i].severity] < rank[list[i - 1].severity]) return false;
  }
  return true;
}
for (const key of PORTAL_KEYS) {
  const specificPrefix = guardrailsForPortal(key).slice(0, -3);
  ok(`${key}: portal-specific prefix severity-sorted`, isSorted(specificPrefix));
}

// --- countBySeverity -------------------------------------------------------
ok(
  "countBySeverity: kijiji has 2 criticals",
  countBySeverity(kijiji, "critical") === 2,
);
ok(
  "countBySeverity: counts match length sum",
  GUARDRAIL_SEVERITIES.reduce(
    (n, s) => n + countBySeverity(kijiji, s),
    0,
  ) === kijiji.length,
);

// --- junk key falls back to the universal checklist ------------------------
const junk = guardrailsForPortal("craigslist");
ok("junk key -> universal floor", junk.length === 3);
ok("junk key -> no critical", !hasCritical("craigslist"));

// --- summary ---------------------------------------------------------------
console.log(`\nlisting-guardrails: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
