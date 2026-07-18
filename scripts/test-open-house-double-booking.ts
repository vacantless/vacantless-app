// Run: npx tsx scripts/test-open-house-double-booking.ts
//
// Source/mechanics checks for S514. There is no rolled-back DB integration
// harness in this repo, so Cowork should still run these SQL checks after
// applying 0159: false -> duplicate scheduled insert raises unique_violation;
// true -> duplicate scheduled inserts succeed with distinct slot_lock values;
// legacy rows have slot_lock = scheduled_at::text; get_public_availability
// returns booked=[] for opted orgs and populated booked for non-opted orgs.

import { readFileSync } from "fs";
import { join } from "path";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function has(src: string, text: string): boolean {
  return src.includes(text);
}

const migration = read("supabase/migrations/0159_allow_double_booking.sql");
const actions = read("app/dashboard/availability/actions.ts");
const page = read("app/dashboard/availability/page.tsx");

// --- migration --------------------------------------------------------------
ok(
  "migration: org flag defaults off",
  has(migration, "add column if not exists allow_double_booking boolean not null default false"),
);
ok(
  "migration: slot_lock column added",
  has(migration, "add column if not exists slot_lock text"),
);
ok(
  "migration: legacy rows backfill slot_lock from scheduled_at",
  /update public\.showings s[\s\S]*set slot_lock = s\.scheduled_at::text[\s\S]*where slot_lock is null;/.test(
    migration,
  ),
);
ok(
  "migration: trigger keeps non-time updates from churning slot_lock",
  has(migration, "new.scheduled_at is not distinct from old.scheduled_at") &&
    has(migration, "new.organization_id is not distinct from old.organization_id") &&
    has(migration, "new.slot_lock is not null"),
);
ok(
  "migration: opted orgs get uuid slot locks",
  has(migration, "when v_allow then gen_random_uuid()::text"),
);
ok(
  "migration: non-opted orgs lock by timestamp",
  has(migration, "else new.scheduled_at::text"),
);
ok(
  "migration: trigger installed before insert or update",
  /create trigger trg_set_showing_slot_lock[\s\S]*before insert or update on public\.showings/.test(
    migration,
  ),
);
ok(
  "migration: unique index swapped to slot_lock with scheduled predicate",
  has(migration, "drop index if exists showings_org_slot_unique") &&
    /create unique index if not exists showings_org_slot_unique[\s\S]*on public\.showings \(organization_id, slot_lock\)[\s\S]*where outcome = 'scheduled';/.test(
      migration,
    ),
);
ok(
  "migration: does not rewrite booking RPCs",
  !/create or replace function public\.(book_public_showing|accept_reschedule_proposal)\b/.test(
    migration,
  ),
);

// --- get_public_availability ------------------------------------------------
ok(
  "availability RPC: same signature/security shape",
  /create or replace function public\.get_public_availability\(p_property_id uuid\)[\s\S]*returns jsonb[\s\S]*language sql[\s\S]*stable[\s\S]*security definer[\s\S]*set search_path = public/.test(
    migration,
  ),
);
ok(
  "availability RPC: opted org booked array is empty",
  has(
    migration,
    "'booked', case when coalesce(o.allow_double_booking, false) then '[]'::jsonb",
  ),
);
ok(
  "availability RPC: non-opted booked query still uses scheduled future org showings",
  /select jsonb_agg\(s\.scheduled_at\)[\s\S]*from public\.showings s[\s\S]*where s\.organization_id = o\.id[\s\S]*and s\.outcome = 'scheduled'[\s\S]*and s\.scheduled_at >= now\(\)/.test(
    migration,
  ),
);
ok(
  "availability RPC: clustering payload preserved",
  has(migration, "'cluster_candidates', coalesce((") &&
    has(migration, "join public.properties cp on cp.id = s.property_id") &&
    has(migration, "and cp.status <> 'off_market'"),
);

// --- action wiring ----------------------------------------------------------
ok(
  "action: setAllowDoubleBooking exported with boolean input",
  /export async function setAllowDoubleBooking\(enabled: boolean\)/.test(actions),
);
ok(
  "action: same availability permission gate",
  has(actions, 'requireCapability("manage_availability", "/dashboard/availability?forbidden=1")'),
);
ok(
  "action: org-scoped allow_double_booking update",
  /\.update\(\{\s*allow_double_booking: enabled\s*\}\)[\s\S]*\.eq\("id", org\.id\)/.test(
    actions,
  ),
);
ok(
  "action: revalidates and redirects back to availability",
  has(actions, 'revalidatePath("/dashboard/availability")') &&
    has(actions, 'redirect("/dashboard/availability?saved=double_booking")'),
);

// --- page wiring ------------------------------------------------------------
ok(
  "page: imports setAllowDoubleBooking",
  has(page, "setAllowDoubleBooking,"),
);
ok(
  "page: reads allow_double_booking from organizations",
  has(page, "showing_block_capacity, allow_double_booking, viewing_reminder_enabled"),
);
ok(
  "page: defaults allow_double_booking off",
  has(page, "allow_double_booking: false"),
);
ok(
  "page: checkbox is wired to allow_double_booking",
  has(page, 'name="allow_double_booking"') &&
    has(page, "defaultChecked={cfg.allow_double_booking}"),
);
ok(
  "page: exact label and help copy present",
  has(page, "Open-house booking — allow multiple bookings per time") &&
    has(
      page,
      "When on, a viewing time stays bookable even after someone books it,",
    ) &&
    has(page, "time can be booked once."),
);
ok(
  "page: form routes through setAllowDoubleBooking",
  has(page, "async function saveAllowDoubleBooking(formData: FormData)") &&
    has(page, 'await setAllowDoubleBooking(formData.get("allow_double_booking") === "on")') &&
    has(page, "action={saveAllowDoubleBooking}"),
);
ok(
  "app code: slot_lock is not set outside the migration/test",
  !actions.includes("slot_lock") && !page.includes("slot_lock"),
);

console.log(`\nopen-house-double-booking: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
