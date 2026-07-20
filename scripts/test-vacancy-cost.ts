// Unit tests for vacancy-cost display models.
// Run: npx tsx scripts/test-vacancy-cost.ts
import assert from "node:assert/strict";
import {
  daysVacant,
  dollarsLostSoFar,
  portfolioTimeToLease,
  vacancyStripModel,
} from "../lib/vacancy-cost";

const now = "2026-07-20T12:00:00.000Z";

assert.equal(
  daysVacant({
    status: "available",
    availableSince: "2026-07-17T12:00:00.000Z",
    now,
  }),
  3,
);

assert.equal(dollarsLostSoFar({ rentCents: 300000, days: 3 }), 30000);

const known = vacancyStripModel(
  [
    {
      id: "unit-known",
      status: "available",
      availableSince: "2026-07-17T12:00:00.000Z",
      rentCents: 300000,
    },
  ],
  now,
);
assert.deepEqual(known.units[0], {
  id: "unit-known",
  isVacant: true,
  days: 3,
  lostCents: 30000,
});

const unknownStart = vacancyStripModel(
  [
    {
      status: "available",
      availableSince: null,
      rentCents: 300000,
    },
  ],
  now,
);
assert.equal(unknownStart.units[0].days, null);
assert.equal(unknownStart.units[0].lostCents, null);
assert.equal(unknownStart.portfolio.unknownVacantUnits, 1);
assert.equal(unknownStart.portfolio.totalLostCents, null);

assert.equal(
  daysVacant({
    status: "leased",
    availableSince: "2026-07-17T12:00:00.000Z",
    now,
  }),
  null,
);

assert.equal(dollarsLostSoFar({ rentCents: null, days: 3 }), null);

assert.deepEqual(
  portfolioTimeToLease([
    { daysOnMarket: 10 },
    { daysOnMarket: null },
    { daysOnMarket: 20 },
    { daysOnMarket: undefined },
  ]),
  { averageDays: 15, sampleSize: 2 },
);

assert.deepEqual(portfolioTimeToLease([]), {
  averageDays: null,
  sampleSize: 0,
});

assert.equal(
  daysVacant({
    status: "available",
    availableSince: "2026-07-19T12:00:01.000Z",
    now,
  }),
  0,
);
assert.equal(
  daysVacant({
    status: "available",
    availableSince: "2026-07-19T12:00:00.000Z",
    now,
  }),
  1,
);

const portfolio = vacancyStripModel(
  [
    {
      status: "available",
      availableSince: "2026-07-18T12:00:00.000Z",
      rentCents: 150000,
    },
    { status: "available", availableSince: null, rentCents: 120000 },
    { daysOnMarket: 12 },
    { daysOnMarket: 18 },
  ],
  now,
);
assert.equal(portfolio.portfolio.vacantUnits, 2);
assert.equal(portfolio.portfolio.knownVacantUnits, 1);
assert.equal(portfolio.portfolio.totalLostCents, 10000);
assert.deepEqual(portfolio.portfolio.timeToLease, {
  averageDays: 15,
  sampleSize: 2,
});

console.log("vacancy-cost: ok");
