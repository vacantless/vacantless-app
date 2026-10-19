// S724 (V251-29): what the landlord approves. The approval box used to say only
// "Your ad is ready". It now shows the ad's main facts, built from the same
// values the posting robot sends: the unit, then the building, then the
// account's standard policy. A fact we do not have is said plainly, because the
// robot then falls back (pets unknown is posted as No pets; unknown utilities
// are left blank).

import { formatRent } from "./listing-copy";
import { friendlyDate } from "./ai-reply";
import { PARKING_TYPE_LABELS, type ParkingType, type UnitFeatures } from "./property-features";

export type AdPreviewInput = {
  title: string | null;
  rentCents: number | null;
  beds: number | null;
  baths: number | null;
  description: string | null;
  photoCount: number;
  features: UnitFeatures;
};

export type AdPreviewFact = { label: string; value: string; missing?: boolean };

export type AdPreview = {
  title: string | null;
  facts: AdPreviewFact[];
  descriptionStart: string | null;
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function petsLine(f: UnitFeatures): AdPreviewFact {
  const cats = f.pets_cats ?? null;
  const dogs = f.pets_dogs ?? null;
  if (cats === true && dogs === true) return { label: "Pets", value: "Cats and dogs OK" };
  if (cats === true) return { label: "Pets", value: dogs === false ? "Cats OK, no dogs" : "Cats OK" };
  if (dogs === true) return { label: "Pets", value: cats === false ? "Dogs OK, no cats" : "Dogs OK" };
  if (cats === false && dogs === false) return { label: "Pets", value: "No pets" };
  if (f.pet_friendly === false) return { label: "Pets", value: "No pets" };
  if (f.pet_friendly === true) return { label: "Pets", value: "Pets OK" };
  return { label: "Pets", value: "Not set, so we post No pets.", missing: true };
}

export function utilitiesLine(f: UnitFeatures): AdPreviewFact {
  const parts: Array<[string, boolean | null | undefined]> = [
    ["Heat", f.heat_included],
    ["Hydro", f.hydro_included],
    ["Water", f.water_included],
  ];
  const yes = parts.filter(([, v]) => v === true).map(([n]) => n);
  const known = parts.filter(([, v]) => v === true || v === false).length;
  if (known === 0) return { label: "Included", value: "Not set. Left blank on the sites.", missing: true };
  if (yes.length === 0) return { label: "Included", value: known === 3 ? "No utilities" : "None marked included" };
  return { label: "Included", value: yes.join(", ") };
}

export function parkingLine(f: UnitFeatures): AdPreviewFact | null {
  const t = (f.parking_type ?? null) as ParkingType | null;
  if (t && PARKING_TYPE_LABELS[t]) {
    const n = f.parking_count;
    if (t === "none") return { label: "Parking", value: PARKING_TYPE_LABELS[t] };
    return { label: "Parking", value: n && n > 0 ? `${PARKING_TYPE_LABELS[t]}, ${plural(n, "spot", "spots")}` : PARKING_TYPE_LABELS[t] };
  }
  const free = (f.parking ?? "").trim();
  return free ? { label: "Parking", value: free.length > 60 ? free.slice(0, 57) + "..." : free } : null;
}

export function buildAdPreview(input: AdPreviewInput): AdPreview {
  const f = input.features ?? {};
  const facts: AdPreviewFact[] = [];
  const rent = formatRent(input.rentCents);
  facts.push(rent ? { label: "Rent", value: rent } : { label: "Rent", value: "Not set", missing: true });
  const rooms: string[] = [];
  if (input.beds != null) rooms.push(input.beds === 0 ? "Studio" : plural(input.beds, "bedroom", "bedrooms"));
  if (input.baths != null) rooms.push(plural(input.baths, "bathroom", "bathrooms"));
  if (rooms.length) facts.push({ label: "Size", value: rooms.join(", ") });
  const when = friendlyDate(f.available_date ?? null);
  facts.push(when ? { label: "Available", value: when } : { label: "Available", value: "Not set", missing: true });
  facts.push(petsLine(f));
  facts.push(utilitiesLine(f));
  const parking = parkingLine(f);
  if (parking) facts.push(parking);
  if (f.furnished === true) facts.push({ label: "Furnished", value: "Yes" });
  facts.push(
    input.photoCount > 0
      ? { label: "Photos", value: String(input.photoCount) }
      : { label: "Photos", value: "None yet", missing: true },
  );
  const d = (input.description ?? "").replace(/\s+/g, " ").trim();
  return {
    title: input.title?.trim() || null,
    facts,
    descriptionStart: d ? (d.length > 180 ? d.slice(0, 177).trimEnd() + "..." : d) : null,
  };
}
