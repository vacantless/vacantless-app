// S736 (review item 9): the email a landlord sends themselves from the rental
// page, to open the Marketplace kit on their phone. Pure, so the copy is
// tested. The link itself is the email's button.

export function phoneKitEmail(input: { address: string | null }): { subject: string; body: string } {
  const where = (input.address ?? "").trim() || "your rental";
  return {
    subject: `Post ${where} on Marketplace from your phone`,
    body:
      `Open this email on your phone. Then press the button below.\n\n` +
      `It opens the Marketplace steps for ${where}.\n` +
      "Copy the ad, save the photos and post it from the Facebook app.\n" +
      "Then paste the link to your ad on the same page.\n\n" +
      "The link works for 14 days, without signing in.",
  };
}
