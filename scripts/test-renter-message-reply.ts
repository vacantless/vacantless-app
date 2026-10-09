// Run with: npx tsx scripts/test-renter-message-reply.ts
import { buildRenterMessageReply } from "../lib/listing-copy";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => (c ? pass++ : (fail++, console.error(`FAIL: ${n}`)));
const url = "https://app.vacantless.com/r/abc";
const plain = buildRenterMessageReply({ publicUrl: url });
ok("has the link", plain.includes(url));
ok("no phone line without a phone", !plain.includes("call"));
const withPhone = buildRenterMessageReply({ publicUrl: url, phone: " 519-915-8865 ext 103 " });
ok("phone line when set", withPhone.endsWith("call 519-915-8865 ext 103."));
ok("blank phone ignored", !buildRenterMessageReply({ publicUrl: url, phone: "  " }).includes("call"));
ok("no em dash", !withPhone.includes("—"));
console.log(`\nrenter-message-reply: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
