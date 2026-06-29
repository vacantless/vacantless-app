// Unit tests for the pure "Today" action lane.
// Run: npx tsx scripts/test-dashboard-today.ts
import { buildTodayLane, type TodayInput } from "../lib/dashboard-today";

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

const ZERO: TodayInput = {
  inquiriesNeedingReply: 0,
  viewingsToday: 0,
  messagesAwaitingApproval: 0,
  rentIncreasesOverdue: 0,
  urgentWorkOrders: 0,
};

// Empty input -> empty lane (the "all caught up" case).
{
  const items = buildTodayLane(ZERO);
  ok("empty input yields no items", items.length === 0);
}

// Each signal surfaces exactly one item when present alone.
{
  ok(
    "inquiries only -> 1 item, key inquiries",
    (() => {
      const i = buildTodayLane({ ...ZERO, inquiriesNeedingReply: 2 });
      return i.length === 1 && i[0].key === "inquiries";
    })(),
  );
  ok(
    "viewings only -> key viewings",
    buildTodayLane({ ...ZERO, viewingsToday: 1 })[0]?.key === "viewings",
  );
  ok(
    "messages only -> key messages",
    buildTodayLane({ ...ZERO, messagesAwaitingApproval: 3 })[0]?.key ===
      "messages",
  );
  ok(
    "rent increases only -> key rent-increases",
    buildTodayLane({ ...ZERO, rentIncreasesOverdue: 1 })[0]?.key ===
      "rent-increases",
  );
  ok(
    "work orders only -> key work-orders",
    buildTodayLane({ ...ZERO, urgentWorkOrders: 4 })[0]?.key === "work-orders",
  );
}

// Singular vs plural copy.
{
  ok(
    "singular inquiry copy",
    buildTodayLane({ ...ZERO, inquiriesNeedingReply: 1 })[0].label ===
      "1 inquiry needs a reply",
  );
  ok(
    "plural inquiries copy",
    buildTodayLane({ ...ZERO, inquiriesNeedingReply: 5 })[0].label ===
      "5 inquiries need a reply",
  );
  ok(
    "singular viewing copy",
    buildTodayLane({ ...ZERO, viewingsToday: 1 })[0].label === "1 viewing today",
  );
  ok(
    "plural viewings copy",
    buildTodayLane({ ...ZERO, viewingsToday: 2 })[0].label === "2 viewings today",
  );
  ok(
    "singular rent increase copy",
    buildTodayLane({ ...ZERO, rentIncreasesOverdue: 1 })[0].label ===
      "1 rent increase is past due to serve",
  );
  ok(
    "plural rent increases copy",
    buildTodayLane({ ...ZERO, rentIncreasesOverdue: 3 })[0].label ===
      "3 rent increases are past due to serve",
  );
  ok(
    "singular urgent repair copy",
    buildTodayLane({ ...ZERO, urgentWorkOrders: 1 })[0].label ===
      "1 urgent repair open",
  );
}

// Ordering: most time-critical first, in a fixed order.
{
  const items = buildTodayLane({
    inquiriesNeedingReply: 1,
    viewingsToday: 1,
    messagesAwaitingApproval: 1,
    rentIncreasesOverdue: 1,
    urgentWorkOrders: 1,
  });
  ok("all five present -> 5 items", items.length === 5);
  ok(
    "fixed order: inquiries, viewings, messages, rent-increases, work-orders",
    items.map((i) => i.key).join(",") ===
      "inquiries,viewings,messages,rent-increases,work-orders",
  );
}

// Tone assignment.
{
  ok(
    "inquiries are urgent",
    buildTodayLane({ ...ZERO, inquiriesNeedingReply: 1 })[0].tone === "urgent",
  );
  ok(
    "viewings are action",
    buildTodayLane({ ...ZERO, viewingsToday: 1 })[0].tone === "action",
  );
  ok(
    "rent increases are urgent",
    buildTodayLane({ ...ZERO, rentIncreasesOverdue: 1 })[0].tone === "urgent",
  );
}

// Every item has a non-empty href, label, detail.
{
  const items = buildTodayLane({
    inquiriesNeedingReply: 1,
    viewingsToday: 1,
    messagesAwaitingApproval: 1,
    rentIncreasesOverdue: 1,
    urgentWorkOrders: 1,
  });
  ok(
    "all items carry href/label/detail",
    items.every((i) => i.href && i.label && i.detail),
  );
  ok(
    "all hrefs are dashboard routes",
    items.every((i) => i.href.startsWith("/dashboard/")),
  );
}

// Negative/garbage guards (counts should be >=0 in practice, but never throw).
{
  ok(
    "negative counts are treated as absent",
    buildTodayLane({ ...ZERO, inquiriesNeedingReply: -1 }).length === 0,
  );
}

console.log(`\ndashboard-today: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
