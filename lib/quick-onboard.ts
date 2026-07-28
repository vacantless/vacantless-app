import { validateLandlordContactEmail } from "./public-contact";
import { parseDateOrNull, parseMoneyToCents } from "./tenancy";

export const QUICK_ONBOARD_FIRST_TOUCH_EVENT =
  "landlord.quick_onboard_first_touch";

export type QuickOnboardInput = {
  landlordName: string | null | undefined;
  landlordEmail: string | null | undefined;
  propertyAddress: string | null | undefined;
  occupancyDate: string | null | undefined;
  rent: string | number | null | undefined;
  marketingConsent: boolean;
};

export type QuickOnboardValues = {
  landlordName: string;
  landlordEmail: string;
  propertyAddress: string;
  occupancyDate: string;
  rentCents: number | null;
  marketingConsent: boolean;
};

export type QuickOnboardValidation =
  | { ok: true; value: QuickOnboardValues }
  | {
      ok: false;
      code:
        | "landlord_name"
        | "landlord_email"
        | "property_address"
        | "occupancy_date"
        | "rent";
    };

export function validateQuickOnboardInput(
  input: QuickOnboardInput,
): QuickOnboardValidation {
  const landlordName = String(input.landlordName ?? "").trim();
  if (!landlordName) return { ok: false, code: "landlord_name" };

  const landlordEmail = validateLandlordContactEmail(input.landlordEmail);
  if (!landlordEmail.ok || !landlordEmail.value) {
    return { ok: false, code: "landlord_email" };
  }

  const propertyAddress = String(input.propertyAddress ?? "").trim();
  if (!propertyAddress) return { ok: false, code: "property_address" };

  const occupancyDate = parseDateOrNull(String(input.occupancyDate ?? ""));
  if (!occupancyDate) return { ok: false, code: "occupancy_date" };

  const rentRaw =
    typeof input.rent === "number" ? String(input.rent / 100) : String(input.rent ?? "");
  const rentCents = rentRaw.trim() ? parseMoneyToCents(rentRaw) : null;
  if (rentRaw.trim() && rentCents == null) return { ok: false, code: "rent" };

  return {
    ok: true,
    value: {
      landlordName,
      landlordEmail: landlordEmail.value,
      propertyAddress,
      occupancyDate,
      rentCents,
      marketingConsent: input.marketingConsent === true,
    },
  };
}

export function quickOnboardSlugBase(name: string, email: string): string {
  const local = email.split("@")[0] ?? "";
  return (
    `${name}-${local}`
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 44) || "landlord"
  );
}

export function quickOnboardDedupeKey(tenancyId: string): string {
  return `${QUICK_ONBOARD_FIRST_TOUCH_EVENT}:${tenancyId}`;
}

export function buildQuickOnboardFirstTouchDraft(input: {
  landlordName: string;
  propertyAddress: string;
  rentCents: number | null;
  confirmUrl: string;
}): { subject: string; body: string } {
  const firstName = input.landlordName.trim().split(/\s+/)[0] || "there";
  const rentLine =
    input.rentCents == null
      ? "The rent is not on file yet, so the link asks for the current monthly rent."
      : `The rent on file is $${Math.round(input.rentCents / 100).toLocaleString("en-CA")}/month.`;

  return {
    subject: `Confirm current rent for ${input.propertyAddress}`,
    body:
      `Hi ${firstName},\n\n` +
      `I added ${input.propertyAddress} to Vacantless so the lease calendar can track rent increase timing.\n\n` +
      `${rentLine}\n\n` +
      `Please confirm it here:\n${input.confirmUrl}\n\n` +
      "Once that is confirmed, I can keep the rent increase calendar accurate.",
  };
}
