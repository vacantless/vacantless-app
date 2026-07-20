// Unit tests for S530 e-Transfer email capture. Run:
// npx tsx scripts/test-etransfer-ingest.ts
import {
  etransferDedupeKey,
  etransferText,
  parseEtransferNotification,
  proposeEtransferSuggestion,
  type ParsedEtransferNotification,
} from "../lib/etransfer-ingest";
import type { CategorizationRule } from "../lib/categorization-rules";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

function parsed(name: string, body: string, subject = "Interac e-Transfer"): ParsedEtransferNotification {
  const value = parseEtransferNotification({ subject, textBody: body });
  ok(`${name} parses`, value != null);
  if (!value) throw new Error(`${name} did not parse`);
  return value;
}

const official = "Learn more at https://etransfer.interac.ca/en";

const receivedEn = parsed(
  "received EN",
  `Jane Tenant sent you money.
Amount: $2,500.00
Date: July 1, 2026
${official}`,
);
ok("received EN direction", receivedEn.direction === "received");
ok("received EN name", receivedEn.counterpartyName === "Jane Tenant");
ok("received EN amount", receivedEn.amountCents === 250000);
ok("received EN date", receivedEn.txnDate === "2026-07-01");

const receivedFr = parsed(
  "received FR",
  `Jean Locataire vous a envoyé de l'argent
Montant : 1 234,56 $
Date : 1 juillet 2026
Virement Interac
https://virement.interac.ca/fr`,
);
ok("received FR direction", receivedFr.direction === "received");
ok("received FR name", receivedFr.counterpartyName === "Jean Locataire");
ok("received FR amount", receivedFr.amountCents === 123456);
ok("received FR date", receivedFr.txnDate === "2026-07-01");

const sentEn = parsed(
  "sent EN",
  `Your transfer to Maria Cleaning has been sent.
Amount: CAD $650.00
Date: 2026-07-03
Interac e-Transfer
https://etransfer.interac.ca/en`,
);
ok("sent EN direction", sentEn.direction === "sent");
ok("sent EN name", sentEn.counterpartyName === "Maria Cleaning");
ok("sent EN amount", sentEn.amountCents === 65000);
ok("sent EN date", sentEn.txnDate === "2026-07-03");

const sentFr = parsed(
  "sent FR",
  `Votre virement à Jardin Pro a été envoyé
Montant : 850,25 $
Date : 3 juillet 2026
Virement Interac
https://etransfer.interac.ca/fr`,
);
ok("sent FR direction", sentFr.direction === "sent");
ok("sent FR name", sentFr.counterpartyName === "Jardin Pro");
ok("sent FR amount", sentFr.amountCents === 85025);
ok("sent FR date", sentFr.txnDate === "2026-07-03");

const gmailForward = parsed(
  "Gmail forward wrapper",
  `---------- Forwarded message ---------
From: Interac e-Transfer <notify@payments.interac.ca>
Subject: Alex Renter sent you money

> Alex Renter sent you money.
> Amount: $1,234.56
> Date: Jul 8, 2026
> https://etransfer.interac.ca/en`,
  "Fwd: Alex Renter sent you money",
);
ok("Gmail wrapper strips quoted name", gmailForward.counterpartyName === "Alex Renter");
ok("Gmail wrapper amount", gmailForward.amountCents === 123456);
ok("Gmail wrapper date", gmailForward.txnDate === "2026-07-08");

const outlookForward = parsed(
  "Outlook forward wrapper",
  `From: INTERAC
Sent: Monday, July 6, 2026
To: owner@example.com
Subject: Your transfer to Painter Co

You sent $775.00 to Painter Co.
Date: July 6, 2026
Interac e-Transfer
Visit interac.ca for details.`,
  "FW: Your transfer to Painter Co",
);
ok("Outlook wrapper direction", outlookForward.direction === "sent");
ok("Outlook wrapper name", outlookForward.counterpartyName === "Painter Co");
ok("Outlook wrapper amount", outlookForward.amountCents === 77500);

const html = parseEtransferNotification({
  subject: "TR: Votre virement",
  htmlBody: `<div>Votre virement Interac à Plomberie Nord est envoyé</div>
<p>Montant : 1&nbsp;050,00 $</p><p>Date : 9 juillet 2026</p>
<a href="https://etransfer.interac.ca/fr">interac.ca</a>`,
});
ok("HTML body parses", html?.direction === "sent" && html.counterpartyName === "Plomberie Nord");
ok("HTML body amount", html?.amountCents === 105000);

ok(
  "phishing lookalike domain rejected",
  parseEtransferNotification({
    subject: "Interac e-Transfer",
    textBody: `Jane Tenant sent you money.
Amount: $2,500.00
Date: July 1, 2026
https://interac.ca.evil.example/login`,
  }) === null,
);
ok(
  "interac-looking but no official domain rejected",
  parseEtransferNotification({
    subject: "Interac e-Transfer",
    textBody: `Jane Tenant sent you money.
Amount: $2,500.00
Date: July 1, 2026
https://interac-security.example.com`,
  }) === null,
);
ok(
  "official domain but no template marker rejected",
  parseEtransferNotification({
    subject: "Payment notice",
    textBody: `Someone paid an invoice.
Amount: $2,500.00
Date: July 1, 2026
https://interac.ca`,
  }) === null,
);
ok(
  "missing amount rejected",
  parseEtransferNotification({
    subject: "Interac e-Transfer",
    textBody: `Jane Tenant sent you money.
Date: July 1, 2026
https://interac.ca`,
  }) === null,
);
ok(
  "missing date rejected",
  parseEtransferNotification({
    subject: "Interac e-Transfer",
    textBody: `Jane Tenant sent you money.
Amount: $2,500.00
https://interac.ca`,
  }) === null,
);
ok(
  "ambiguous received and sent body rejected",
  parseEtransferNotification({
    subject: "Interac e-Transfer",
    textBody: `Jane Tenant sent you money.
Your transfer to Painter Co has been sent.
Amount: $2,500.00
Date: July 1, 2026
https://interac.ca`,
  }) === null,
);

const text = etransferText({
  subject: "Test",
  htmlBody: "<p>Line&nbsp;one</p><p>Line &amp; two</p>",
});
ok("etransferText decodes simple HTML", text.includes("Line one") && text.includes("Line & two"));

const keyA = etransferDedupeKey("inbound", "mid-1", receivedEn);
const keyB = etransferDedupeKey("inbound", "mid-1", sentEn);
const keyC = etransferDedupeKey("inbound", null, receivedEn);
const keyD = etransferDedupeKey("inbound", null, { ...receivedEn });
ok("dedupe key uses message-id first", keyA === keyB);
ok("dedupe key hashes to sha256 hex", /^[a-f0-9]{64}$/.test(keyA));
ok("tuple fallback is stable", keyC === keyD);
ok("tuple fallback differs from message-id key", keyA !== keyC);

const rentSuggestion = proposeEtransferSuggestion(
  receivedEn,
  [{ tenancyId: "ten-1", rentCents: 250000, label: "Unit 1" }],
  [],
);
ok("received likely rent suggests tenancy", rentSuggestion.suggestedTenancyId === "ten-1");
ok("received likely rent records classification", rentSuggestion.rentClassification === "likely_rent");

const offcycleSuggestion = proposeEtransferSuggestion(
  { ...receivedEn, txnDate: "2026-07-20" },
  [{ tenancyId: "ten-1", rentCents: 250000, label: "Unit 1" }],
  [],
);
ok("received off-cycle does not guess tenancy", offcycleSuggestion.suggestedTenancyId === null);

const payeeRules: CategorizationRule[] = [
  {
    id: "rule-1",
    scopeKind: "merchant",
    merchantEntityId: null,
    streamId: null,
    merchantNorm: "maria cleaning",
    accountExternalId: null,
    amountMinCents: null,
    amountMaxCents: null,
    dayMin: null,
    dayMax: null,
    category: "maintenance",
    propertyId: "prop-1",
    buildingKey: null,
  },
];
const sentSuggestion = proposeEtransferSuggestion(sentEn, [], payeeRules);
ok("sent payee rule suggests category", sentSuggestion.suggestedCategory === "maintenance");
ok("sent payee rule suggests property", sentSuggestion.suggestedPropertyId === "prop-1");
ok("sent payee rule marks rule match", sentSuggestion.ruleMatched);

const noRuleSuggestion = proposeEtransferSuggestion(sentFr, [], []);
ok("sent without rule leaves category empty", noRuleSuggestion.suggestedCategory === null);
ok("sent without rule has no property", noRuleSuggestion.suggestedPropertyId === null);

console.log(`\netransfer-ingest: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
