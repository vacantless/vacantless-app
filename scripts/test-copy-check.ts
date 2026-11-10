// S777: "Check for copies" builds three searches the landlord opens; we never search the sites.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { copyCheckCity, copyCheckLinks, copyCheckPriceWindow } from "../lib/copy-check";

let n = 0;
function ok(name: string, fn: () => void) { fn(); n++; console.log("ok", name); }

ok("city from a Windsor address", () => {
  assert.equal(copyCheckCity("833 Pillette Rd, Unit 3, Windsor, ON N8Y 3B4"), "Windsor");
});
ok("city fallback is the part before the province", () => {
  assert.equal(copyCheckCity("12 Main St, Smallville, ON K0K 1A0"), "Smallville");
  assert.equal(copyCheckCity("12 Main St"), null);
  assert.equal(copyCheckCity(null), null);
});
ok("price window 70% to 110%, whole fifties", () => {
  assert.deepEqual(copyCheckPriceWindow(125000), { low: 850, high: 1400 });
  assert.equal(copyCheckPriceWindow(null), null);
  assert.equal(copyCheckPriceWindow(0), null);
});
ok("all three links for a full rental", () => {
  const l = copyCheckLinks({
    address: "833 Pillette Rd, Unit 36, Windsor, ON N8Y 3B4",
    rentCents: 145000,
    beds: 2,
    coverPhotoUrl: "https://x.supabase.co/storage/v1/object/public/property-photos/a/b.jpg",
  });
  assert.equal(l.kijiji, "https://www.kijiji.ca/b-apartments-condos/canada/windsor/k0c37l0?price=1000__1600");
  assert.equal(l.marketplace, "https://www.facebook.com/marketplace/category/propertyrentals?minPrice=1000&maxPrice=1600&minBedrooms=2");
  assert.ok(l.lens?.startsWith("https://lens.google.com/uploadbyurl?url=https%3A%2F%2Fx.supabase.co"));
  assert.equal(l.priceLabel, "$1,000 to $1,600");
});
ok("no rent, no price searches; bachelor has no bedroom filter", () => {
  const a = copyCheckLinks({ address: "1 A St, Windsor, ON", rentCents: null, beds: 1, coverPhotoUrl: null });
  assert.equal(a.kijiji, null); assert.equal(a.marketplace, null); assert.equal(a.lens, null);
  const b = copyCheckLinks({ address: "1 A St, Windsor, ON", rentCents: 90000, beds: 0, coverPhotoUrl: "http://plain/x.jpg" });
  assert.ok(!b.marketplace!.includes("minBedrooms")); assert.equal(b.lens, null);
});
ok("card copy: no em dashes, says we do not search for you", () => {
  const src = readFileSync("app/dashboard/properties/[id]/copy-check-card.tsx", "utf8");
  assert.ok(!src.includes("—"));
  assert.ok(src.includes("Vacantless does not search these sites for you"));
});
console.log(`copy-check: ${n} passed`);
