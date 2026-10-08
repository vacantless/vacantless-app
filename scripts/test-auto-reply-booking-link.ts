// Run with: npx tsx scripts/test-auto-reply-booking-link.ts
// S702: the enquiry auto-reply invites the renter to book when the listing has
// open viewing times, instead of only promising a callback.
import { sendAutoReply, type AutoReplyPayload } from "../lib/email";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

const sent: { subject: string; htmlContent: string }[] = [];
process.env.BREVO_API_KEY = "test-key";
globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
  sent.push(JSON.parse(String(init?.body ?? "{}")));
  return new Response(JSON.stringify({ messageId: "x" }), { status: 201 });
}) as typeof fetch;

const base: AutoReplyPayload = {
  lead_id: "l1",
  org_id: "o1",
  renter_name: "Sam Renter",
  renter_email: "sam@example.com",
  org_name: "Test Rentals",
  brand_color: "#17362f",
  logo_url: null,
  reply_to_email: null,
  property_address: "100 Test Street, Unit 3",
  rent_cents: 150000,
  template_subject: null,
  template_body: null,
};

async function main() {
  await sendAutoReply({ ...base, booking_url: "https://app.vacantless.com/r/p1?p=post1" });
  const withLink = sent[0]?.htmlContent ?? "";
  ok("link present", withLink.includes('href="https://app.vacantless.com/r/p1?p=post1"'));
  ok("button copy", withLink.includes("Pick a viewing time"));
  ok("no callback promise when bookable", !withLink.includes("will be in touch shortly"));
  ok("rent formatted with comma", withLink.includes("$1,500/month"));

  await sendAutoReply({ ...base, booking_url: null });
  const noLink = sent[1]?.htmlContent ?? "";
  ok("no link when no times", !noLink.includes("Pick a viewing time"));
  ok("callback copy kept when no times", noLink.includes("will be in touch shortly to arrange a viewing"));

  await sendAutoReply({ ...base });
  ok("booking_url omitted -> old copy", (sent[2]?.htmlContent ?? "").includes("will be in touch shortly"));

  await sendAutoReply({
    ...base,
    template_body: "<p>Book here: {{booking_url}}</p>",
    booking_url: "https://app.vacantless.com/r/p1",
  });
  ok("template token filled", (sent[3]?.htmlContent ?? "").includes("Book here: https://app.vacantless.com/r/p1"));

  await sendAutoReply({ ...base, booking_url: 'https://x.test/r/p1?a="><script>' });
  ok("url is escaped", !(sent[4]?.htmlContent ?? "").includes('"><script>'));

  console.log(`\nauto-reply-booking-link: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main();
