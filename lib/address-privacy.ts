export type AddressDisplayMode = "full" | "hide_unit" | "approximate";

export function normalizeAddressDisplayMode(
  value: string | null | undefined,
): AddressDisplayMode {
  return value === "hide_unit" || value === "approximate" ? value : "full";
}

export function publicAddressLabel(input: {
  address: string | null;
  unitLabel?: string | null;
  city?: string | null;
  mode: AddressDisplayMode | null | undefined;
}): string {
  const address = input.address ?? "";
  const mode = normalizeAddressDisplayMode(input.mode);
  if (mode === "full") return address;

  const city = clean(input.city) ?? cityFromAddress(address);
  const cleaned = clean(address);
  if (!cleaned) return city ?? "";

  const withoutUnit = stripUnitPortion(cleaned, input.unitLabel);

  if (mode === "hide_unit") {
    return clean(withoutUnit) ?? city ?? "";
  }

  return approximateAddress(withoutUnit, city);
}

function stripUnitPortion(
  address: string,
  unitLabel: string | null | undefined,
): string {
  let out = address;
  const label = clean(unitLabel);

  if (label) {
    out = out.replace(
      new RegExp(`(^|[,\\s-]+)${escapeRegExp(label)}(?=\\s*,|\\s*-|\\s+|$)`, "gi"),
      "$1",
    );
  }

  out = out
    .replace(/^\s*(?:unit|suite|ste|apt|apartment)\s+[a-z0-9-]+\s*[-,]\s*/i, "")
    .replace(/^\s*#\s*[a-z0-9-]+\s*[-,]?\s*/i, "")
    .replace(/\s*,\s*(?:unit|suite|ste|apt|apartment)\s+[a-z0-9-]+\b/gi, "")
    .replace(/\s*,\s*#\s*[a-z0-9-]+\b/gi, "")
    .replace(/\s+(?:unit|suite|ste|apt|apartment)\s+[a-z0-9-]+\b(?=\s*,|$)/gi, "")
    .replace(/\s+#\s*[a-z0-9-]+\b(?=\s*,|$)/gi, "");

  return cleanAddressPunctuation(out);
}

function approximateAddress(address: string, city: string | null): string {
  const cleaned = cleanAddressPunctuation(address);
  if (!cleaned) return city ?? "";

  const parts = cleaned
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const first = parts[0] ?? cleaned;
  const streetName = stripCivicNumber(first);

  if (!streetName) return city ?? "";

  return city ? `${streetName}, ${city}` : streetName;
}

function stripCivicNumber(firstAddressPart: string): string | null {
  const stripped = firstAddressPart.replace(
    /^\s*\d+[a-z]?(?:\s*[-/]\s*\d+[a-z]?)?\s+/i,
    "",
  );
  const cleaned = clean(stripped);
  if (!cleaned || cleaned === clean(firstAddressPart)) return null;
  return cleaned;
}

function cityFromAddress(address: string): string | null {
  const parts = address
    .split(",")
    .map((part) => clean(part))
    .filter((part): part is string => Boolean(part));

  for (const part of parts.slice(1)) {
    if (isUnitFragment(part) || isRegionFragment(part)) continue;
    return part;
  }
  return null;
}

function isUnitFragment(value: string): boolean {
  return /^(?:unit|suite|ste|apt|apartment)\s+[a-z0-9-]+$/i.test(value) ||
    /^#\s*[a-z0-9-]+$/i.test(value);
}

function isRegionFragment(value: string): boolean {
  return /^(?:on|ontario|canada|ca)$/i.test(value) ||
    /^[a-z]\d[a-z]\s*\d[a-z]\d$/i.test(value);
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}

function cleanAddressPunctuation(value: string): string {
  return value
    .replace(/\s*,\s*,+/g, ", ")
    .replace(/\s*-\s*,/g, ",")
    .replace(/,\s*-/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s*[,/-]\s*/g, "")
    .replace(/\s*[,/-]\s*$/g, "")
    .replace(/\s+,/g, ",")
    .replace(/,\s*/g, ", ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
