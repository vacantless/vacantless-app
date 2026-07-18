// Run with: npx tsx scripts/test-lead-no-suitable-time.ts
//
// Source-level S513b guard. The database migration is intentionally not applied
// by this script; it verifies the checked-in migration/RPC/form/action/template
// wiring that will be exercised once migration 0160 is applied.
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

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

const migration = read("supabase/migrations/0160_lead_no_suitable_time.sql");
const inquiryForm = read("app/r/[propertyId]/inquiry-form.tsx");
const actions = read("app/r/[propertyId]/actions.ts");
const notifications = read("lib/notifications.ts");
const leadDetail = read("lib/lead-detail.ts");
const leadPage = read("app/dashboard/leads/[id]/page.tsx");
const nurture = read("lib/nurture.ts");
const email = read("lib/email.ts");
const nurtureCron = read("app/api/cron/nurture/route.ts");

// --- migration / RPC --------------------------------------------------------
ok(
  "migration: adds no_suitable_time non-null default",
  /add column if not exists no_suitable_time\s+boolean\s+not null\s+default false/i.test(
    migration,
  ),
);
ok(
  "migration: drops old 12-arg submit_public_lead signature",
  /drop function if exists public\.submit_public_lead\(\s*uuid,\s*text,\s*text,\s*text,\s*date,\s*text,\s*uuid,\s*integer,\s*integer,\s*boolean,\s*text,\s*jsonb\);/i.test(
    migration,
  ),
);
ok(
  "migration: appends defaulted p_no_suitable_time parameter",
  /p_custom_answers\s+jsonb\s+default\s+'\[\]'::jsonb,\s*p_no_suitable_time\s+boolean\s+default\s+false\s*\)/i.test(
    migration,
  ),
);
ok("migration: keeps submit source as website", migration.includes("v_source       text := 'website';"));
ok(
  "migration: inserts no_suitable_time column",
  /screen_custom_answers,\s*no_suitable_time\)/i.test(migration),
);
ok(
  "migration: writes coalesced no_suitable_time value",
  /coalesce\(p_no_suitable_time,\s*false\)\)/i.test(migration),
);
ok(
  "migration: grants new 13-arg signature",
  /grant execute on function\s+public\.submit_public_lead\(\s*uuid,\s*text,\s*text,\s*text,\s*date,\s*text,\s*uuid,\s*integer,\s*integer,\s*boolean,\s*text,\s*jsonb,\s*boolean\s*\)/i.test(
    migration,
  ),
);

// --- public intake ----------------------------------------------------------
ok(
  "form: posts no_suitable_time when no slots or renter skips times",
  inquiryForm.includes("{(!hasSlots || skipTime) && (") &&
    inquiryForm.includes('name="no_suitable_time"') &&
    inquiryForm.includes('value="1"'),
);
ok(
  "action: parses hidden no_suitable_time flag",
  actions.includes('formData.get("no_suitable_time") === "1"'),
);
ok(
  "action: passes flag to submit_public_lead RPC",
  actions.includes("p_no_suitable_time: noSuitableTime"),
);
ok(
  "action: adds operator note when renter could not find a time",
  actions.includes("no_suitable_time_note") &&
    actions.includes("couldn't find a workable viewing time"),
);

// --- operator notification --------------------------------------------------
ok(
  "notifications: new-lead event declares no_suitable_time_note token",
  notifications.includes('"no_suitable_time_note"'),
);
ok(
  "notifications: default new-lead body renders no_suitable_time_note",
  notifications.includes("{{no_suitable_time_note}}"),
);

// --- dashboard lead detail --------------------------------------------------
ok(
  "lead-detail: exposes pure noSuitableTimeBadge helper",
  leadDetail.includes("export function noSuitableTimeBadge") &&
    leadDetail.includes("Wanted to book — no suitable time"),
);
ok(
  "lead page: selects no_suitable_time",
  leadPage.includes("source_detail, no_suitable_time, status"),
);
ok(
  "lead page: renders noSuitableTimeBadge result",
  leadPage.includes("noSuitableTimeBadge(l.no_suitable_time)") &&
    leadPage.includes("{noSuitableTimeText}"),
);

// --- nurture copy path ------------------------------------------------------
ok(
  "nurture: has flagged copy variant",
  nurture.includes("NO_SUITABLE_TIME_STEP_COPY") &&
    nurture.includes("lining up more viewing times"),
);
ok(
  "nurture: copy selector accepts noSuitableTime boolean",
  nurture.includes("nurtureCopy(step: number, noSuitableTime = false)") &&
    nurture.includes("noSuitableTime ? NO_SUITABLE_TIME_STEP_COPY : STEP_COPY"),
);
ok(
  "email: nurture payload carries no_suitable_time",
  email.includes("export type NurturePayload") &&
    email.includes("no_suitable_time?: boolean | null;"),
);
ok(
  "email: passes no_suitable_time into nurtureCopy",
  email.includes("nurtureCopy(p.step, p.no_suitable_time === true)"),
);
ok(
  "nurture cron: selects no_suitable_time",
  nurtureCron.includes('"no_suitable_time, nurture_step_sent, nurture_last_sent_at, "'),
);
ok(
  "nurture cron: sends no_suitable_time to email composer",
  nurtureCron.includes("no_suitable_time: row.no_suitable_time === true"),
);

console.log(`\nlead-no-suitable-time: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
