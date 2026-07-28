export type RentConfirmStatus = "unchanged" | "changed";

export type ParsedRentConfirmSubmission =
  | {
      ok: true;
      status: RentConfirmStatus;
      currentRentCents: number | null;
      effectiveDate: string | null;
    }
  | { ok: false; reason: "bad_status" | "bad_rent" | "bad_date" };

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com";

export function rentConfirmUrl(token: string): string {
  return `${APP_URL.replace(/\/+$/g, "")}/confirm-rent/${encodeURIComponent(
    token.trim(),
  )}`;
}

export function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

export function parseRentDollarsToCents(value: string | null | undefined): number | null {
  const amount = Number.parseFloat(String(value ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

export function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function parseRentConfirmSubmission(input: {
  status: string | null | undefined;
  currentRent: string | null | undefined;
  effectiveDate: string | null | undefined;
}): ParsedRentConfirmSubmission {
  const status = String(input.status ?? "").trim();
  if (status !== "unchanged" && status !== "changed") {
    return { ok: false, reason: "bad_status" };
  }
  if (status === "unchanged") {
    return {
      ok: true,
      status,
      currentRentCents: null,
      effectiveDate: null,
    };
  }

  const currentRentCents = parseRentDollarsToCents(input.currentRent);
  if (currentRentCents == null) {
    return { ok: false, reason: "bad_rent" };
  }
  const effectiveDate = String(input.effectiveDate ?? "").trim();
  if (!isIsoDate(effectiveDate)) {
    return { ok: false, reason: "bad_date" };
  }

  return {
    ok: true,
    status,
    currentRentCents,
    effectiveDate,
  };
}
