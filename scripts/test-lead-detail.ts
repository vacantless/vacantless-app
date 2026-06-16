// Unit tests for the pure lead-detail logic.
// Run: npx tsx scripts/test-lead-detail.ts
import {
  resolveLeadSource,
  followUpStatus,
  daysUntilFollowUp,
  followUpLabel,
  suggestedNextStages,
  suggestedNextStageOptions,
} from "../lib/lead-detail";

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

// --- resolveLeadSource: joined post wins ------------------------------------
ok(
  "source: post portal -> label + url",
  (() => {
    const r = resolveLeadSource({
      source: "website",
      source_detail: null,
      post: { portal: "kijiji", label: null, url: "https://kijiji.ca/v/123" },
    });
    return r?.label === "Kijiji" && r?.url === "https://kijiji.ca/v/123";
  })(),
);
ok(
  "source: post facebook label",
  resolveLeadSource({
    source: null,
    source_detail: null,
    post: { portal: "facebook", label: null, url: null },
  })?.label === "Facebook Marketplace",
);
ok(
  "source: post other -> free-text label",
  resolveLeadSource({
    source: null,
    source_detail: null,
    post: { portal: "other", label: "PadMapper", url: null },
  })?.label === "PadMapper",
);
ok(
  "source: post other blank label -> Other portal",
  resolveLeadSource({
    source: null,
    source_detail: null,
    post: { portal: "other", label: "  ", url: null },
  })?.label === "Other portal",
);
ok(
  "source: post bare-domain url gets https",
  resolveLeadSource({
    source: null,
    source_detail: null,
    post: { portal: "kijiji", label: null, url: "kijiji.ca/v/9" },
  })?.url === "https://kijiji.ca/v/9",
);

// --- resolveLeadSource: fallback to source/source_detail --------------------
ok(
  "source: label only, no url",
  (() => {
    const r = resolveLeadSource({ source: "Website", source_detail: null });
    return r?.label === "Website" && r?.url === null;
  })(),
);
ok(
  "source: label + url detail",
  (() => {
    const r = resolveLeadSource({
      source: "Kijiji",
      source_detail: "https://kijiji.ca/v/42",
    });
    return r?.label === "Kijiji" && r?.url === "https://kijiji.ca/v/42";
  })(),
);
ok(
  "source: non-url detail is not promoted to link",
  resolveLeadSource({ source: "Phone call", source_detail: "left voicemail" })
    ?.url === null,
);
ok(
  "source: url-only detail, no label -> Source link",
  (() => {
    const r = resolveLeadSource({
      source: null,
      source_detail: "https://ad.example/x",
    });
    return r?.label === "Source link" && r?.url === "https://ad.example/x";
  })(),
);
ok(
  "source: nothing -> null",
  resolveLeadSource({ source: null, source_detail: null }) === null,
);
ok(
  "source: blanks -> null",
  resolveLeadSource({ source: "  ", source_detail: "  " }) === null,
);
ok(
  "source: post takes priority over source text",
  resolveLeadSource({
    source: "website",
    source_detail: "https://other.example",
    post: { portal: "rentals_ca", label: null, url: "https://rentals.ca/1" },
  })?.label === "Rentals.ca",
);

// --- followUpStatus ---------------------------------------------------------
ok("followUp: none when null", followUpStatus(null, "2026-06-15") === "none");
ok(
  "followUp: overdue (past)",
  followUpStatus("2026-06-10", "2026-06-15") === "overdue",
);
ok(
  "followUp: today (same day)",
  followUpStatus("2026-06-15", "2026-06-15") === "today",
);
ok(
  "followUp: upcoming (future)",
  followUpStatus("2026-06-20", "2026-06-15") === "upcoming",
);
ok(
  "followUp: invalid date -> none",
  followUpStatus("not-a-date", "2026-06-15") === "none",
);
ok(
  "followUp: month boundary overdue",
  followUpStatus("2026-05-31", "2026-06-01") === "overdue",
);

// --- daysUntilFollowUp ------------------------------------------------------
ok("days: -5 overdue", daysUntilFollowUp("2026-06-10", "2026-06-15") === -5);
ok("days: 0 today", daysUntilFollowUp("2026-06-15", "2026-06-15") === 0);
ok("days: +3 upcoming", daysUntilFollowUp("2026-06-18", "2026-06-15") === 3);
ok("days: null when missing", daysUntilFollowUp(null, "2026-06-15") === null);

// --- followUpLabel ----------------------------------------------------------
ok("label: empty when null", followUpLabel(null, "2026-06-15") === "");
ok(
  "label: overdue plural",
  followUpLabel("2026-06-13", "2026-06-15") === "Overdue by 2 days",
);
ok(
  "label: overdue singular",
  followUpLabel("2026-06-14", "2026-06-15") === "Overdue by 1 day",
);
ok("label: due today", followUpLabel("2026-06-15", "2026-06-15") === "Due today");
ok(
  "label: due tomorrow",
  followUpLabel("2026-06-16", "2026-06-15") === "Due tomorrow",
);
ok(
  "label: due in N days",
  followUpLabel("2026-06-20", "2026-06-15") === "Due in 5 days",
);

// --- suggestedNextStages ----------------------------------------------------
ok(
  "stages: new -> replied/contacted/lost",
  JSON.stringify(suggestedNextStages("new")) ===
    JSON.stringify(["replied", "contacted", "lost"]),
);
ok(
  "stages: booked -> showed/lost",
  JSON.stringify(suggestedNextStages("booked")) ===
    JSON.stringify(["showed", "lost"]),
);
ok("stages: leased -> [] (terminal)", suggestedNextStages("leased").length === 0);
ok(
  "stages: lost -> new (reopen)",
  JSON.stringify(suggestedNextStages("lost")) === JSON.stringify(["new"]),
);
ok("stages: junk -> []", suggestedNextStages("zzz").length === 0);
ok(
  "stages: never suggests current stage",
  suggestedNextStages("contacted").every((s) => s !== "contacted"),
);
ok(
  "stageOptions: carries labels",
  (() => {
    const opts = suggestedNextStageOptions("applied");
    return (
      opts.length === 2 &&
      opts[0].stage === "leased" &&
      opts[0].label === "Leased" &&
      opts[1].stage === "lost" &&
      opts[1].label === "Lost"
    );
  })(),
);

// ---------------------------------------------------------------------------
console.log(`\nlead-detail: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
