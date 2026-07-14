// Run with: npx tsx scripts/test-booking-confirmation-copy.ts
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

function eq(name: string, got: unknown, want: unknown) {
  if (got === want) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name} - got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

process.env.BREVO_API_KEY = "test-key";
process.env.BREVO_SENDER_EMAIL = "leads@vacantless.test";

const sends: unknown[] = [];
globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
  sends.push(JSON.parse(String(init?.body ?? "{}")));
  return new Response("{}", { status: 201 });
}) as typeof fetch;

const basePayload = {
  lead_id: "lead_123",
  renter_name: "Gurpreet Singh",
  renter_email: "gurpreet@example.com",
  org_name: "Agile Rentals",
  brand_color: "#111827",
  logo_url: null,
  reply_to_email: "rentals@agileonline.ca",
  property_address: "833 Pillette Rd, Unit 20",
  when_label: "Tue, Jul 14, 5:30 PM EDT",
  cancel_url: "https://app.vacantless.test/showing/cancel/token",
  leasing_phone: "226-773-7555",
};

const actionsSource = readFileSync(
  new URL("../app/r/[propertyId]/actions.ts", import.meta.url),
  "utf8",
);
const successBlockStart = actionsSource.indexOf("if (b.showing_id) {");
const successBlockEnd = actionsSource.indexOf("// Notify the org's leasing team", successBlockStart);
const successBlock = actionsSource.slice(successBlockStart, successBlockEnd);
ok("source has booking success block", successBlockStart >= 0 && successBlockEnd > successBlockStart);
ok(
  "source calls viewing booked alert in success branch",
  successBlock.includes("await notifyOperatorsOfViewingBooked(b.showing_id);"),
);
ok(
  "source keeps auto-assign before viewing-booked alert",
  successBlock.indexOf("await autoAssignBookedShowing(b.showing_id);") <
    successBlock.indexOf("await notifyOperatorsOfViewingBooked(b.showing_id);"),
);
ok(
  "source sends viewing_booked event",
  actionsSource.includes('eventKey: "leasing.viewing_booked"'),
);
ok(
  "source threads booking_requires_confirmation from extras",
  actionsSource.includes("booking_requires_confirmation?: boolean | null") &&
    actionsSource.includes("bookingRequiresConfirmation = e.booking_requires_confirmation === true"),
);

const migrationSource = readFileSync(
  new URL("../supabase/migrations/0146_booking_requires_confirmation.sql", import.meta.url),
  "utf8",
);
ok(
  "migration defaults flag false",
  migrationSource.includes("booking_requires_confirmation boolean not null default false"),
);
ok(
  "migration opts Agile in",
  migrationSource.includes("slug = 'agile'") &&
    migrationSource.includes("rentals@agileonline.ca"),
);
ok(
  "migration exposes flag in public listing",
  migrationSource.includes("'booking_requires_confirmation', o.booking_requires_confirmation"),
);
ok(
  "migration exposes flag in booking extras",
  migrationSource.includes("'booking_requires_confirmation', o.booking_requires_confirmation"),
);

async function main() {
  const { sendBookingConfirmation } = await import("../lib/email");

  sends.length = 0;
  const defaultResult = await sendBookingConfirmation({
    ...basePayload,
    booking_requires_confirmation: false,
  });
  const defaultBody = sends[0] as {
    subject?: string;
    htmlContent?: string;
  };
  eq(
    "email default subject unchanged",
    defaultResult.subject,
    "Your viewing at 833 Pillette Rd, Unit 20 is confirmed",
  );
  eq("email default sends same subject", defaultBody.subject, defaultResult.subject);
  ok(
    "email default keeps confirmed intro",
    String(defaultBody.htmlContent).includes("Your viewing is confirmed. Here are the details:"),
  );
  ok(
    "email default keeps arrive wording",
    String(defaultBody.htmlContent).includes("Please arrive at the address above at your scheduled time."),
  );
  ok("email default keeps see-you signoff", String(defaultBody.htmlContent).includes("See you then,"));

  sends.length = 0;
  const confirmFirstResult = await sendBookingConfirmation({
    ...basePayload,
    booking_requires_confirmation: true,
  });
  const confirmFirstBody = sends[0] as {
    subject?: string;
    htmlContent?: string;
  };
  eq(
    "email confirm-first subject",
    confirmFirstResult.subject,
    "Your viewing request at 833 Pillette Rd, Unit 20 is in",
  );
  eq("email confirm-first sends same subject", confirmFirstBody.subject, confirmFirstResult.subject);
  ok(
    "email confirm-first says request is in",
    String(confirmFirstBody.htmlContent).includes("Your viewing request is in."),
  );
  ok(
    "email confirm-first says agent will confirm",
    String(confirmFirstBody.htmlContent).includes("Someone from Agile Rentals will reach out to confirm before your viewing."),
  );
  ok(
    "email confirm-first avoids old intro",
    !String(confirmFirstBody.htmlContent).includes("Your viewing is confirmed. Here are the details:"),
  );

  console.log(`\nbooking-confirmation-copy: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
