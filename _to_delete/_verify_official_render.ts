import fs from "node:fs";
import { fillOfficialN1 } from "../lib/n1-official-pdf";
import type { N1Snapshot } from "../lib/n1-render";

const snap: N1Snapshot = {
  currentRentCents: 220000,
  newRentCents: 224180,
  increaseCents: 4180,
  currentRent: "$2,200",
  newRent: "$2,241.8",
  increaseAmount: "$41.8",
  guidelinePercent: 1.9,
  effectiveDate: "2027-06-28",
  serveByDate: "2027-03-30",
  exempt: false,
  landlordName: "North Star Rentals QA",
  landlordPhone: "(519) 915-8865",
  landlordEmail: "rentals@vacantless-demo.ca",
  tenantNames: ["Liang Wu", "Mei Wu"],
  rentalUnitAddress: "18 Shorncliffe Avenue, Toronto, ON",
  capturedAtIso: new Date().toISOString(),
};

(async () => {
  const bytes = await fillOfficialN1(snap);
  fs.writeFileSync("_n1_official_verify.pdf", Buffer.from(bytes));
  console.log("WROTE _n1_official_verify.pdf bytes=", bytes.length);
})();
