// S724 (V251-03): picking an address suggestion used to overwrite the whole
// field with the provider's label, which drops the unit ("Suite 124") and can
// swap in a different postal code. mergeAddressSuggestion keeps what the
// landlord typed that the suggestion lacks, and reports a postal-code conflict
// so the form can say so instead of silently replacing it.

const POSTAL_RE = /\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])\s?(\d[ABCEGHJ-NPRSTV-Z]\d)\b/i;
const UNIT_WORD_RE = /\b(unit|suite|apt\.?|apartment|ph|penthouse)\s*#?\s*([A-Za-z0-9-]{1,8})\b/i;
const HASH_UNIT_RE = /(?:^|[\s,])#\s*([A-Za-z0-9-]{1,8})\b/;
const LEADING_UNIT_RE = /^\s*([A-Za-z0-9]{1,6})\s*-\s*\d+\s+\S/;

export type AddressUnit = { word: string; value: string };

export function findPostalCode(text: string): string | null {
  const m = POSTAL_RE.exec(text ?? "");
  return m ? `${m[1]} ${m[2]}`.toUpperCase() : null;
}

function titleWord(word: string): string {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w === "apt" || w === "apartment") return "Apt";
  if (w === "ph" || w === "penthouse") return "PH";
  return w.charAt(0).toUpperCase() + w.slice(1);
}

export function findUnit(text: string): AddressUnit | null {
  const t = text ?? "";
  const word = UNIT_WORD_RE.exec(t);
  if (word) return { word: titleWord(word[1]), value: word[2] };
  const hash = HASH_UNIT_RE.exec(t);
  if (hash) return { word: "Unit", value: hash[1] };
  const lead = LEADING_UNIT_RE.exec(t);
  if (lead) return { word: "Unit", value: lead[1] };
  return null;
}

function hasUnit(label: string, unit: AddressUnit): boolean {
  const found = findUnit(label);
  return !!found && found.value.toLowerCase() === unit.value.toLowerCase();
}

export type MergedAddress = {
  address: string;
  keptUnit: AddressUnit | null;
  postalConflict: { typed: string; suggested: string } | null;
};

export function mergeAddressSuggestion(typed: string, suggestionLabel: string): MergedAddress {
  let address = (suggestionLabel ?? "").trim();
  const unit = findUnit(typed ?? "");
  let keptUnit: AddressUnit | null = null;
  if (unit && !hasUnit(address, unit)) {
    // Put the unit right after the street part: "251 Manitoba St, Suite 124, Toronto, ON".
    const firstComma = address.indexOf(",");
    const piece = `${unit.word} ${unit.value}`;
    // A leading "124-251 Manitoba St" style suggestion already carries it.
    address = firstComma > 0
      ? `${address.slice(0, firstComma)}, ${piece}${address.slice(firstComma)}`
      : `${address}, ${piece}`;
    keptUnit = unit;
  }
  const typedPostal = findPostalCode(typed ?? "");
  const suggestedPostal = findPostalCode(address);
  let postalConflict: MergedAddress["postalConflict"] = null;
  if (typedPostal && suggestedPostal && typedPostal !== suggestedPostal) {
    // Keep the landlord's postal code; the suggestion's is often the building's centroid.
    address = address.replace(POSTAL_RE, typedPostal);
    postalConflict = { typed: typedPostal, suggested: suggestedPostal };
  } else if (typedPostal && !suggestedPostal) {
    address = `${address} ${typedPostal}`;
  }
  return { address, keptUnit, postalConflict };
}
