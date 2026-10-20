// S726g: the two texting set-up emails. Pure, so the copy is tested.
// 1. Staff: a Growth landlord pressed "Turn on texting" (requestTexting).
// 2. Landlord: staff added and switched on their number (setOrgSmsNumberAsAdmin).

const APP = "https://app.vacantless.com";

export function textingRequestEmail(input: {
  orgName: string | null;
  orgId: string;
  requesterEmail: string | null;
  addresses: string[];
}): { subject: string; body: string } {
  const name = input.orgName || "An account";
  const where = input.addresses.length
    ? input.addresses.slice(0, 3).map((a) => `- ${a}`).join("\n")
    : "- No rentals yet. Ask them where they rent.";
  return {
    subject: `Texting request: ${input.orgName || input.orgId}`,
    body:
      `${name} asked for texting.\n` +
      `Asked by: ${input.requesterEmail || "unknown"}\n` +
      `Account id: ${input.orgId}\n\n` +
      `Their rentals, to pick the area code:\n${where}\n\n` +
      "1. Buy a local Canadian number in Twilio with that area code.\n" +
      `2. Set its incoming text webhook to ${APP}/api/sms/inbound\n` +
      `3. Set its incoming call webhook to ${APP}/api/sms/voice\n` +
      `4. Add the number here, and tick On: ${APP}/dashboard/admin#texting-numbers\n` +
      "5. Send one test text and check that it was delivered.\n\n" +
      "Saving the number emails the landlord that texting is on.",
  };
}

/** "+12267980746" -> "226-798-0746". Anything else comes back as given. */
export function displayCanadianNumber(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : e164;
}

export function textingOnEmail(input: { orgName: string | null; phoneE164: string }): {
  subject: string;
  body: string;
} {
  const n = displayCanadianNumber(input.phoneE164);
  return {
    subject: "Texting is on",
    body:
      `Texting is on for ${input.orgName || "your account"}.\n\n` +
      `Your number is ${n}.\n` +
      "Renters who leave a phone number now get their booking confirmation by text. " +
      "They also get viewing reminders by text, as well as email.\n\n" +
      "When a renter texts back, we email you their message.\n" +
      `See your texts used this month: ${APP}/dashboard/settings?tab=comms`,
  };
}
