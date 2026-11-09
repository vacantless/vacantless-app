import assert from "node:assert/strict";
import {
  siteLights,
  postMissingLabel,
  renewLine,
  listRank,
  sortForList,
  listHeadline,
  todoSummary,
} from "../lib/rental-list-view";

let n = 0;
const check = (fn: () => void) => {
  fn();
  n++;
};

// Site lights: live and missing merged in site order, live ads carry their link.
check(() => {
  const lights = siteLights(
    { live: ["zumper", "facebook"], missing: ["rentals_ca", "kijiji"] },
    new Map([["zumper", "https://zumper.com/x"]]),
  );
  assert.deepEqual(lights.map((l) => l.key), ["facebook", "kijiji", "rentals_ca", "zumper"]);
  assert.deepEqual(lights.map((l) => l.live), [true, false, false, true]);
  assert.equal(lights[3].url, "https://zumper.com/x");
  assert.equal(lights[0].url, null);
  assert.equal(lights[1].url, null);
  assert.equal(lights[0].label, "Marketplace");
});
check(() => assert.deepEqual(siteLights({ live: [], missing: [] }, new Map()), []));
// A live site the account no longer offers still shows, lit.
check(() => {
  const lights = siteLights({ live: ["kijiji"], missing: ["facebook"] }, new Map());
  assert.deepEqual(lights.map((l) => [l.key, l.live]), [["facebook", false], ["kijiji", true]]);
});

check(() => assert.equal(postMissingLabel([]), ""));
check(() => assert.equal(postMissingLabel(["kijiji"]), "Post to Kijiji"));
check(() => assert.equal(postMissingLabel(["kijiji", "rentals_ca"]), "Post to Kijiji and Rentals.ca"));
check(() => assert.equal(postMissingLabel(["kijiji", "rentals_ca", "zumper"]), "Post to 3 sites"));

check(() => assert.equal(renewLine({ portal: "kijiji", label: "Kijiji", days: 28 }), "Kijiji ad is 28 days old"));
check(() => assert.equal(renewLine({ portal: "facebook", label: "Facebook Marketplace", days: null }), "Marketplace ad needs a renew"));

// Order: live, setting up, paused, off market, rented; ties keep input order.
check(() => {
  assert.equal(listRank("available", true), 0);
  assert.equal(listRank("draft", false), 1);
  assert.equal(listRank("paused", false), 2);
  assert.equal(listRank("off_market", false), 3);
  assert.equal(listRank("leased", false), 4);
});
check(() => {
  const rows = [
    { id: "a", status: "leased", b: false },
    { id: "b", status: "available", b: true },
    { id: "c", status: "off_market", b: false },
    { id: "d", status: "available", b: true },
    { id: "e", status: "draft", b: false },
  ];
  assert.deepEqual(sortForList(rows, (r) => listRank(r.status, r.b)).map((r) => r.id), ["b", "d", "e", "c", "a"]);
});

check(() => {
  const h = listHeadline([
    { status: "available", bookable: true, inquiries: 23, needsYou: true },
    { status: "available", bookable: true, inquiries: 8, needsYou: false },
    { status: "leased", bookable: false, inquiries: 112, needsYou: false },
    { status: "off_market", bookable: false, inquiries: 1, needsYou: false },
  ]);
  assert.deepEqual(h, { live: 2, rented: 1, inquiries: 144, needYou: 1 });
});
check(() => assert.deepEqual(listHeadline([]), { live: 0, rented: 0, inquiries: 0, needYou: 0 }));

check(() => assert.equal(todoSummary(0, 0), ""));
check(() => assert.equal(todoSummary(1, 0), "1 rental is missing a site"));
check(() => assert.equal(todoSummary(4, 3), "4 rentals are missing a site · 3 ads to renew"));
check(() => assert.equal(todoSummary(0, 1), "1 ad to renew"));

console.log(`PASS test-rental-list-view (${n} checks)`);
