// S705: landlord-phishing enquiries are held out of the lead list.
// Run: npx tsx scripts/test-portal-lead-scam.ts
// Fixtures are synthetic, written in the shape of the 2026-10-11 messages.
import {
  isLandlordPhishing,
  isPlaceholderPhone,
  landlordPhishingTells,
} from "../lib/portal-lead-scam";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
    if (extra !== undefined) console.error("    ->", JSON.stringify(extra));
  }
}

const SCAM =
  "Extra Check. To confirm your property and account, you need to run our \"Listing Check\" application on your computer. " +
  "This step is here to protect people from fraudulent listings! You have exactly 24 hours to install and launch the application; " +
  "otherwise, your account will be blocked. To download, copy this and paste it into your browser: [LINK REMOVED FOR SAFETY] " +
  "Your personal password to open the program: Example2026";

const scamLead = { name: "Rentals Alert", phone: "(111) 111-1111", message: SCAM };
ok("the 10-11 shape is held", isLandlordPhishing(scamLead), landlordPhishingTells(scamLead));
ok(
  "the 10-11 shape carries every tell",
  landlordPhishingTells(scamLead).length === 6,
  landlordPhishingTells(scamLead),
);
ok(
  "held even with a real-looking name and phone",
  isLandlordPhishing({ name: "Jordan Smith", phone: "(519) 555-0142", message: SCAM }),
);
ok(
  "a shorter variant (install + threat) is held",
  isLandlordPhishing({
    name: "Sam",
    phone: "519-555-0199",
    message: "Please install the application on your computer within 12 hours or your listing will be removed.",
  }),
);

// Real renters must never be held.
const RENTERS = [
  "Hi, is this unit still available? I'd like to book a viewing this weekend.",
  "Can I download the application form somewhere or do you send it by email?",
  "I work in IT and can install a smart thermostat on my own if that's allowed. Is the unit still open?",
  "Is the place still available? I can apply within 24 hours if so.",
  "Hello, I am interested. Do you need me to verify my income? I can send pay stubs.",
  "My phone is acting up so text me. Is parking included? Need a 1 bedroom by November.",
  "",
];
for (const message of RENTERS) {
  ok(
    `renter not held: "${message.slice(0, 50)}"`,
    !isLandlordPhishing({ name: "Renter Example", phone: "(519) 555-0134", message }),
    landlordPhishingTells({ name: "Renter Example", phone: "(519) 555-0134", message }),
  );
}
ok(
  "a placeholder phone alone never holds a renter",
  !isLandlordPhishing({ name: "Renter", phone: "(111) 111-1111", message: RENTERS[0] }),
);
ok(
  "a staff-sounding name alone never holds a renter",
  !isLandlordPhishing({ name: "Support Worker", phone: null, message: RENTERS[0] }),
);
ok(
  "an install request alone never holds a renter",
  !isLandlordPhishing({
    name: "Renter",
    phone: "(519) 555-0134",
    message: "You need to download the app on your phone? I can't open the booking page.",
  }),
);

ok("placeholder: repeated digit", isPlaceholderPhone("(111) 111-1111"));
ok("placeholder: with country code", isPlaceholderPhone("+1 000 000 0000"));
ok("placeholder: sequence", isPlaceholderPhone("123-456-7890"));
ok("real phone is not a placeholder", !isPlaceholderPhone("(519) 915-8865"));
ok("missing phone is not a placeholder", !isPlaceholderPhone(null));

console.log(`\nportal-lead-scam: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
