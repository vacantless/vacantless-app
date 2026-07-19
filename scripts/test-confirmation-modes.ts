// Run with: npx tsx scripts/test-confirmation-modes.ts
import { readFileSync } from "node:fs";
import {
  autoReleaseDue,
  HOUR_MS,
  isAtRisk,
} from "../lib/reminders";

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

const now = 1_000_000_000_000;
const at = (hoursFromNow: number) => now + hoursFromNow * HOUR_MS;

// --- at-risk board eligibility --------------------------------------------
ok("agent-mode upcoming unconfirmed scheduled viewing is at risk",
  isAtRisk({
    scheduledAtMs: at(2),
    nowMs: now,
    mode: "agent",
    confirmed: false,
    outcome: "scheduled",
  }));
ok("auto mode never shows at-risk",
  !isAtRisk({
    scheduledAtMs: at(2),
    nowMs: now,
    mode: "auto",
    confirmed: false,
    outcome: "scheduled",
  }));
ok("confirmed viewing is not at-risk",
  !isAtRisk({
    scheduledAtMs: at(2),
    nowMs: now,
    mode: "agent",
    confirmed: true,
    outcome: "scheduled",
  }));
ok("closed viewing is not at-risk",
  !isAtRisk({
    scheduledAtMs: at(2),
    nowMs: now,
    mode: "agent",
    confirmed: false,
    outcome: "attended",
  }));
ok("past viewing is not at-risk",
  !isAtRisk({
    scheduledAtMs: at(-1),
    nowMs: now,
    mode: "agent",
    confirmed: false,
    outcome: "scheduled",
  }));
ok("more than 48h out is not at-risk",
  !isAtRisk({
    scheduledAtMs: at(49),
    nowMs: now,
    mode: "agent",
    confirmed: false,
    outcome: "scheduled",
  }));

// --- auto-release decision -------------------------------------------------
ok("enabled agent-mode unconfirmed scheduled viewing is due inside release window",
  autoReleaseDue({
    scheduledAtMs: at(2),
    nowMs: now,
    mode: "agent",
    enabled: true,
    hoursBefore: 2,
    confirmed: false,
    outcome: "scheduled",
  }));
ok("outside release window is not due",
  !autoReleaseDue({
    scheduledAtMs: at(2.1),
    nowMs: now,
    mode: "agent",
    enabled: true,
    hoursBefore: 2,
    confirmed: false,
    outcome: "scheduled",
  }));
ok("auto-release default-off gate matters",
  !autoReleaseDue({
    scheduledAtMs: at(2),
    nowMs: now,
    mode: "agent",
    enabled: false,
    hoursBefore: 2,
    confirmed: false,
    outcome: "scheduled",
  }));
ok("auto mode cannot auto-release",
  !autoReleaseDue({
    scheduledAtMs: at(2),
    nowMs: now,
    mode: "auto",
    enabled: true,
    hoursBefore: 2,
    confirmed: false,
    outcome: "scheduled",
  }));
ok("confirmed viewing cannot auto-release",
  !autoReleaseDue({
    scheduledAtMs: at(2),
    nowMs: now,
    mode: "agent",
    enabled: true,
    hoursBefore: 2,
    confirmed: true,
    outcome: "scheduled",
  }));
for (const outcome of ["attended", "no_show", "cancelled"]) {
  ok(`${outcome} viewing cannot auto-release`,
    !autoReleaseDue({
      scheduledAtMs: at(2),
      nowMs: now,
      mode: "agent",
      enabled: true,
      hoursBefore: 2,
      confirmed: false,
      outcome,
    }));
}
ok("invalid release hours cannot release",
  !autoReleaseDue({
    scheduledAtMs: at(2),
    nowMs: now,
    mode: "agent",
    enabled: true,
    hoursBefore: 25,
    confirmed: false,
    outcome: "scheduled",
  }));

// --- source wiring ---------------------------------------------------------
const migration = readFileSync(
  new URL("../supabase/migrations/0165_operator_confirmation_layer.sql", import.meta.url),
  "utf8",
);
ok("migration adds showing_confirm_mode default auto",
  migration.includes("showing_confirm_mode text not null default 'auto'"));
ok("migration constrains mode to auto/agent",
  migration.includes("showing_confirm_mode in ('auto', 'agent')"));
ok("migration adds default-off auto-release",
  migration.includes("auto_release_unconfirmed_enabled boolean not null default false"));
ok("migration constrains release hours 1-24",
  migration.includes("auto_release_unconfirmed_hours between 1 and 24"));

const orgSource = readFileSync(new URL("../lib/org.ts", import.meta.url), "utf8");
ok("getCurrentOrg selects confirmation mode columns",
  orgSource.includes("showing_confirm_mode, auto_release_unconfirmed_enabled, auto_release_unconfirmed_hours"));

const actionsSource = readFileSync(
  new URL("../app/dashboard/showings/actions.ts", import.meta.url),
  "utf8",
);
ok("operator confirm action exists",
  actionsSource.includes("export async function confirmShowingByOperator"));
ok("operator confirm stamps agent",
  actionsSource.includes('confirmed_by: "agent"'));
ok("operator confirm is session-org scoped",
  actionsSource.includes('.eq("organization_id", org.id)'));
ok("operator confirm only writes scheduled unconfirmed rows",
  actionsSource.includes('.eq("outcome", "scheduled")') &&
    actionsSource.includes('.is("confirmed_at", null)'));
ok("manual release reuses release helper",
  actionsSource.includes("releaseUnconfirmedShowing(supabase"));
ok("manual nudge reuses showing reminder email",
  actionsSource.includes("sendShowingReminder({"));

const showingsPage = readFileSync(
  new URL("../app/dashboard/showings/page.tsx", import.meta.url),
  "utf8",
);
ok("at-risk board title is present",
  showingsPage.includes("Unconfirmed viewings (next 48h)"));
ok("at-risk board renders only in agent mode",
  showingsPage.includes('showingConfirmMode === "agent"'));
ok("board wires confirm, nudge, and release actions",
  showingsPage.includes("confirmShowingByOperator") &&
    showingsPage.includes("nudgeRenterForConfirmation") &&
    showingsPage.includes("releaseUnconfirmedShowingByOperator"));

const settingsPage = readFileSync(
  new URL("../app/dashboard/settings/page.tsx", import.meta.url),
  "utf8",
);
const settingsActions = readFileSync(
  new URL("../app/dashboard/settings/actions.ts", import.meta.url),
  "utf8",
);
ok("settings page renders confirmation section",
  settingsPage.includes("Viewing confirmation"));
ok("settings form posts mode and auto-release fields",
  settingsPage.includes('name="showing_confirm_mode"') &&
    settingsPage.includes('name="auto_release_unconfirmed_enabled"') &&
    settingsPage.includes('name="auto_release_unconfirmed_hours"'));
ok("settings action saves only valid modes",
  settingsActions.includes('modeRaw === "agent"') &&
    settingsActions.includes('modeRaw === "auto"'));
ok("settings action forces auto-release to agent mode",
  settingsActions.includes('mode === "agent" && formData.get("auto_release_unconfirmed_enabled") != null'));

const reminderRoute = readFileSync(
  new URL("../app/api/cron/reminders/route.ts", import.meta.url),
  "utf8",
);
ok("reminders cron hosts auto-release pass",
  reminderRoute.includes("runAutoReleasePass") &&
    reminderRoute.includes("autoReleaseDue") &&
    reminderRoute.includes("releaseUnconfirmedShowing"));
ok("auto-release query is opt-in agent mode only",
  reminderRoute.includes('.eq("organizations.showing_confirm_mode", "agent")') &&
    reminderRoute.includes('.eq("organizations.auto_release_unconfirmed_enabled", true)'));

const renterConfirm = readFileSync(
  new URL("../lib/showing-confirmation.ts", import.meta.url),
  "utf8",
);
ok("S520 renter confirm still stamps renter",
  renterConfirm.includes('confirmed_by: "renter"'));

const notifications = readFileSync(
  new URL("../lib/notifications.ts", import.meta.url),
  "utf8",
);
ok("auto-release agent/operator notification is registered",
  notifications.includes('key: "leasing.showing_auto_released"'));

console.log(`\nconfirmation-modes: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
