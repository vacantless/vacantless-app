// ============================================================================
// Pure post-publish QA checker (S412 Slice 6). No DOM / env / IO — unit-tested
// (scripts/test-post-publish-qa.ts).
//
// After a human posts an ad, they paste the ad's text (title + body) back and
// this checks it against what the listing SHOULD say: right city, rent shown,
// the required hydro + unfurnished disclosures, a working booking link, contact
// info, and channel-specific traps. It reads OPERATOR-PASTED text - it never
// fetches or scrapes the portal (that's restricted + unreliable). Guidance, not
// a gate. House rule: hyphens not em dashes.
// ============================================================================

export const QA_SEVERITIES = ["critical", "warning", "tip"] as const;
export type QaSeverity = (typeof QA_SEVERITIES)[number];

export type QaCheck = {
  key: string;
  label: string;
  ok: boolean;
  severity: QaSeverity;
  detail: string;
};

export type QaExpected = {
  city: string | null;
  rentLabel: string | null; // e.g. "$1,295/month"
  requireHydroDisclosure: boolean;
  requireUnfurnishedDisclosure: boolean;
  bookingUrl: string | null;
  phone: string | null;
  email: string | null;
};

function digitsOnly(s: string): string {
  return s.replace(/\D+/g, "");
}

// The rent's integer dollar figure ("$1,295/month" -> "1295"), or null.
function rentDigits(rentLabel: string | null): string | null {
  if (!rentLabel) return null;
  const m = rentLabel.replace(/[^0-9.,]/g, "").match(/[\d,]+/);
  if (!m) return null;
  const d = m[0].replace(/,/g, "");
  return d.length >= 3 ? d : null;
}

export function checkPastedAd(opts: {
  pastedText: string;
  channelKey: string;
  expected: QaExpected;
}): QaCheck[] {
  const { pastedText, channelKey, expected } = opts;
  const text = pastedText.toLowerCase();
  const textNoCommas = text.replace(/,/g, "");
  const checks: QaCheck[] = [];

  // City / location.
  if (expected.city) {
    checks.push({
      key: "city",
      label: "Correct city shown",
      ok: text.includes(expected.city.toLowerCase()),
      severity: "critical",
      detail: `The ad should name ${expected.city}. A wrong or missing city sends renters to the wrong place and kills reach.`,
    });
  }

  // Rent.
  const rd = rentDigits(expected.rentLabel);
  if (rd) {
    checks.push({
      key: "rent",
      label: "Rent shown",
      ok: textNoCommas.includes(rd),
      severity: "critical",
      detail: `The monthly rent (${expected.rentLabel}) should appear in the ad - it's the first thing renters look for.`,
    });
  }

  // Hydro disclosure.
  if (expected.requireHydroDisclosure) {
    checks.push({
      key: "hydro",
      label: "Hydro disclosure present",
      ok: /hydro|electricity|utilities/.test(text),
      severity: "warning",
      detail: "State whether hydro is included so there are no surprises at the viewing.",
    });
  }

  // Unfurnished disclosure.
  if (expected.requireUnfurnishedDisclosure) {
    checks.push({
      key: "furnishing",
      label: "Furnishing stated",
      ok: /unfurnished|not furnished|furnished/.test(text),
      severity: "warning",
      detail: "Say whether the unit is furnished or unfurnished.",
    });
  }

  // Booking link.
  if (expected.bookingUrl) {
    const path = expected.bookingUrl.replace(/^https?:\/\//, "").toLowerCase();
    checks.push({
      key: "booking_link",
      label: "Booking link present",
      ok: text.includes(path) || text.includes(expected.bookingUrl.toLowerCase()),
      severity: "critical",
      detail: "The tracked booking link should be in the ad so inquiries land in your list and are attributed to this channel.",
    });
  }

  // Phone.
  if (expected.phone) {
    const want = digitsOnly(expected.phone).slice(-10);
    checks.push({
      key: "phone",
      label: "Phone correct",
      ok: want.length >= 7 && digitsOnly(pastedText).includes(want),
      severity: "warning",
      detail: "Double-check the phone number in the ad matches your contact number.",
    });
  }

  // Email.
  if (expected.email) {
    checks.push({
      key: "email",
      label: "Email correct",
      ok: text.includes(expected.email.toLowerCase()),
      severity: "tip",
      detail: "Confirm the contact email is right.",
    });
  }

  // Channel-specific traps (tips, always shown).
  if (channelKey === "facebook") {
    checks.push({
      key: "fb_link_risk",
      label: "Facebook link is reachable",
      ok: false,
      severity: "tip",
      detail: "Facebook often won't make a link clickable in Marketplace or DMs. Add the QR image as a photo and tell renters to copy the link into their browser.",
    });
  }
  if (channelKey === "kijiji") {
    checks.push({
      key: "kijiji_location",
      label: "Kijiji location pin",
      ok: false,
      severity: "tip",
      detail: "Confirm the location pin is your real postal code, not a default city center - a wrong pin buries the ad in search.",
    });
  }

  return checks;
}

export function qaSummary(checks: QaCheck[]): {
  criticalFailures: number;
  warnings: number;
  allClear: boolean;
} {
  const criticalFailures = checks.filter(
    (c) => !c.ok && c.severity === "critical",
  ).length;
  const warnings = checks.filter(
    (c) => !c.ok && c.severity === "warning",
  ).length;
  return {
    criticalFailures,
    warnings,
    // "All clear" ignores tips (they're reminders, never pass/fail).
    allClear: criticalFailures === 0 && warnings === 0,
  };
}
