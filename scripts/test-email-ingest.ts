// Unit tests for the pure email/text ingress trust-boundary layer (lib/email-ingest).
// Run: npx tsx scripts/test-email-ingest.ts
import {
  INGEST_LOCALPART_PREFIX,
  DEFAULT_INGEST_DOMAIN,
  isValidIngestToken,
  generateIngestToken,
  formatIngestLocalPart,
  ingestAddressFromToken,
  normalizeIngestSender,
  parseIngestToken,
  pickIngestToken,
  toRecipientList,
  extractAddress,
  normalizeSenderEmail,
  isAllowedSenderEmail,
  isAllowedSenderPhone,
  MAX_INGEST_ATTACHMENT_BYTES,
  sniffIsPdf,
  selectIngestAttachment,
  isAutoReplyOrLoop,
  verifyIngestSecret,
  readIngestSecretFromAuth,
  ingestDedupeKey,
  decideIngest,
  type IngestAttachmentInput,
} from "../lib/email-ingest";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- magic-byte fixtures ----------------------------------------------------
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const NOTANIMAGE = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);

// ===========================================================================
// Token validation + addressing
// ===========================================================================
ok("prefix is u-", INGEST_LOCALPART_PREFIX === "u-");
ok("default domain", DEFAULT_INGEST_DOMAIN === "in.vacantless.com");

const TOK = "abcd1234efgh5678ijkl9012"; // 24 chars, valid
ok("valid token (24 lc-alnum)", isValidIngestToken(TOK));
ok("token too short rejected", !isValidIngestToken("abc123"));
ok("token too long rejected", !isValidIngestToken("a".repeat(65)));
ok("token with uppercase rejected", !isValidIngestToken("ABCD1234efgh5678ijkl9012"));
ok("token with symbol rejected", !isValidIngestToken("abcd-1234efgh5678ijkl9012"));
ok("non-string token rejected", !isValidIngestToken(123 as unknown));

// generateIngestToken shape (never assert a value)
const gen = generateIngestToken();
ok("generated token is valid", isValidIngestToken(gen));
ok("generated tokens differ", generateIngestToken() !== generateIngestToken());
ok("formatIngestLocalPart", formatIngestLocalPart(TOK) === `u-${TOK}`);
ok("ingestAddressFromToken default domain", ingestAddressFromToken(TOK) === `u-${TOK}@in.vacantless.com`);
ok("ingestAddressFromToken custom domain lowercased", ingestAddressFromToken(TOK, "IN.Example.com") === `u-${TOK}@in.example.com`);
// round-trip: an address built from a token parses back to it
ok("address round-trips to token", parseIngestToken(ingestAddressFromToken(TOK)) === TOK);

// normalizeIngestSender — what the allow-list stores must match the inbound compare
ok("normalizeIngestSender email lowercases bare", normalizeIngestSender("email", "Noam <Noam@X.com>") === "noam@x.com");
ok("normalizeIngestSender email rejects junk", normalizeIngestSender("email", "nope") === null);
ok("normalizeIngestSender sms to e164", normalizeIngestSender("sms", "519-915-8865") === "+15199158865");
ok("normalizeIngestSender sms rejects junk", normalizeIngestSender("sms", "abc") === null);

// parseIngestToken
ok(
  "parse exact ingest address",
  parseIngestToken(`u-${TOK}@in.vacantless.com`) === TOK,
);
ok(
  "parse tolerates display name",
  parseIngestToken(`Noam <u-${TOK}@in.vacantless.com>`) === TOK,
);
ok(
  "parse is case-insensitive on domain/prefix",
  parseIngestToken(`U-${TOK}@IN.VACANTLESS.COM`) === TOK,
);
ok("wrong domain -> null", parseIngestToken(`u-${TOK}@vacantless.com`) === null);
ok("missing prefix -> null", parseIngestToken(`${TOK}@in.vacantless.com`) === null);
ok("invalid token -> null", parseIngestToken(`u-short@in.vacantless.com`) === null);
ok("plain recipient -> null", parseIngestToken(`leasing@agileonline.ca`) === null);
ok("garbage -> null", parseIngestToken("not an address") === null);
ok("non-string -> null", parseIngestToken(null) === null);
ok(
  "custom domain honored",
  parseIngestToken(`u-${TOK}@in.example.com`, "in.example.com") === TOK,
);
ok(
  "custom domain rejects default",
  parseIngestToken(`u-${TOK}@in.vacantless.com`, "in.example.com") === null,
);

// pickIngestToken across To+Cc
ok(
  "pick finds token in a list",
  pickIngestToken([`someone@x.com`, `u-${TOK}@in.vacantless.com`]) === TOK,
);
ok(
  "pick parses a comma header value",
  pickIngestToken(`a@x.com, u-${TOK}@in.vacantless.com`) === TOK,
);
ok("pick returns null when none match", pickIngestToken(["a@x.com", "b@y.com"]) === null);
ok("pick handles non-string", pickIngestToken(undefined) === null);
ok(
  "toRecipientList splits comma header",
  JSON.stringify(toRecipientList("a@x.com, B <b@y.com>")) ===
    JSON.stringify(["a@x.com", "B <b@y.com>"]),
);

// ===========================================================================
// Sender identity + allow-list (the real authority)
// ===========================================================================
ok("extractAddress angled", extractAddress("Noam <noam@x.com>") === "noam@x.com");
ok("extractAddress bare", extractAddress("noam@x.com") === "noam@x.com");
ok("extractAddress lowercases", extractAddress("Noam <NOAM@X.COM>") === "noam@x.com");
ok("extractAddress bracket only", extractAddress("<a@b.io>") === "a@b.io");
ok("extractAddress rejects no-domain", extractAddress("noam") === null);
ok("extractAddress rejects empty", extractAddress("") === null);
ok("extractAddress rejects spacey", extractAddress("a b@c.com") === null);
ok("normalizeSenderEmail = extractAddress", normalizeSenderEmail("X <x@y.io>") === "x@y.io");

const ALLOW = ["noam@royallepage.ca", "Noam M <noammuscovitch@gmail.com>"];
ok("allowed sender (exact)", isAllowedSenderEmail("noam@royallepage.ca", ALLOW));
ok("allowed sender (display-name both sides)", isAllowedSenderEmail("Noam <noammuscovitch@gmail.com>", ALLOW));
ok("allowed sender case-insensitive", isAllowedSenderEmail("NOAM@ROYALLEPAGE.CA", ALLOW));
ok("unknown sender rejected", !isAllowedSenderEmail("stranger@evil.com", ALLOW));
ok("empty allowlist fails closed", !isAllowedSenderEmail("noam@royallepage.ca", []));
ok("garbage from fails closed", !isAllowedSenderEmail("not-an-email", ALLOW));
ok("non-array allowlist fails closed", !isAllowedSenderEmail("a@b.com", null as unknown as unknown[]));

// phone variant
const PHONES = ["+15199158865", "(519) 555-0142"];
ok("allowed phone exact e164", isAllowedSenderPhone("+15199158865", PHONES));
ok("allowed phone normalized", isAllowedSenderPhone("519-555-0142", PHONES));
ok("unknown phone rejected", !isAllowedSenderPhone("+12025550000", PHONES));
ok("empty phone allowlist fails closed", !isAllowedSenderPhone("+15199158865", []));

// ===========================================================================
// Attachment selection (magic-byte authority, body ignored)
// ===========================================================================
ok("max attachment = vault cap", MAX_INGEST_ATTACHMENT_BYTES === 25 * 1024 * 1024);
ok("sniffIsPdf true", sniffIsPdf(PDF));
ok("sniffIsPdf false on jpeg", !sniffIsPdf(JPEG));
ok("sniffIsPdf false on short", !sniffIsPdf(new Uint8Array([0x25, 0x50])));

function att(bytes: Uint8Array, contentType?: string, filename?: string): IngestAttachmentInput {
  return { bytes, contentType: contentType ?? null, filename: filename ?? null };
}

{
  const r = selectIngestAttachment([att(JPEG, "image/jpeg", "fridge.jpg")]);
  ok("select jpeg ok", r.ok === true && r.attachment.mimeType === "image/jpeg" && r.attachment.parseable);
}
{
  const r = selectIngestAttachment([att(PDF, "application/pdf", "receipt.pdf")]);
  ok("select pdf ok but not parseable", r.ok === true && r.attachment.mimeType === "application/pdf" && r.attachment.parseable === false);
}
{
  // claimed type lies (says pdf) but bytes are PNG -> sniff wins
  const r = selectIngestAttachment([att(PNG, "application/pdf", "x.pdf")]);
  ok("sniff overrides lying content-type", r.ok === true && r.attachment.mimeType === "image/png");
}
{
  const r = selectIngestAttachment([att(WEBP), att(GIF)]);
  ok("first valid wins (webp before gif)", r.ok === true && r.attachment.mimeType === "image/webp");
}
{
  // skip a non-image first, pick the image second
  const r = selectIngestAttachment([att(NOTANIMAGE, "application/zip"), att(GIF)]);
  ok("skips junk, picks the gif", r.ok === true && r.attachment.mimeType === "image/gif");
}
{
  const r = selectIngestAttachment([]);
  ok("no attachments -> none", r.ok === false && r.reason === "none");
}
{
  const r = selectIngestAttachment([att(NOTANIMAGE, "application/zip")]);
  ok("only junk -> type", r.ok === false && r.reason === "type");
}
{
  const big = new Uint8Array(MAX_INGEST_ATTACHMENT_BYTES + 1);
  big.set(JPEG, 0); // valid magic, but over cap
  const r = selectIngestAttachment([att(big, "image/jpeg")]);
  ok("oversize valid image -> size", r.ok === false && r.reason === "size");
}
{
  // an oversize image followed by a fine image: should pick the fine one
  const big = new Uint8Array(MAX_INGEST_ATTACHMENT_BYTES + 1);
  big.set(PNG, 0);
  const r = selectIngestAttachment([att(big, "image/png"), att(JPEG)]);
  ok("oversize then valid -> picks valid", r.ok === true && r.attachment.mimeType === "image/jpeg");
}
{
  const r = selectIngestAttachment([att(new Uint8Array(0))]);
  ok("empty bytes treated as none", r.ok === false && r.reason === "none");
}
{
  // filename sanitation: path stripped, fallback when unsafe
  const r = selectIngestAttachment([att(JPEG, "image/jpeg", "../../etc/passwd.jpg")]);
  ok("filename path-stripped", r.ok === true && r.attachment.filename === "passwd.jpg");
  const r2 = selectIngestAttachment([att(PNG, "image/png", "no-extension")]);
  ok("filename fallback when no ext", r2.ok === true && r2.attachment.filename === "capture.png");
}

// ===========================================================================
// Loop / auto-reply drop
// ===========================================================================
ok("auto-submitted auto-replied -> loop", isAutoReplyOrLoop({ "auto-submitted": "auto-replied" }));
ok("auto-submitted no -> not loop", !isAutoReplyOrLoop({ "auto-submitted": "no" }));
ok("precedence bulk -> loop", isAutoReplyOrLoop({ precedence: "bulk" }));
ok("precedence list -> loop", isAutoReplyOrLoop({ precedence: "LIST" }));
ok("x-autoreply -> loop", isAutoReplyOrLoop({ "x-autoreply": "yes" }));
ok("mailer-daemon from -> loop", isAutoReplyOrLoop({ from: "MAILER-DAEMON@x.com" }));
ok("no-reply from -> loop", isAutoReplyOrLoop({ from: "no-reply@store.com" }));
ok("bounce from -> loop", isAutoReplyOrLoop({ from: "bounce+abc@x.com" }));
ok("normal from -> not loop", !isAutoReplyOrLoop({ from: "noam@royallepage.ca" }));
ok("empty headers -> not loop", !isAutoReplyOrLoop({}));
ok("null headers -> not loop", !isAutoReplyOrLoop(null));

// ===========================================================================
// Webhook secret verify + auth parsing + dedupe
// ===========================================================================
ok("verify matching secret", verifyIngestSecret("s3cret-value", "s3cret-value"));
ok("verify mismatch", !verifyIngestSecret("wrong", "s3cret-value"));
ok("verify length mismatch", !verifyIngestSecret("short", "longer-secret"));
ok("verify empty provided fails", !verifyIngestSecret("", "x"));
ok("verify unset expected fails closed", !verifyIngestSecret("x", ""));
ok("verify unset expected (null) fails closed", !verifyIngestSecret("x", null));
ok("verify non-string provided fails", !verifyIngestSecret(undefined, "x"));

ok("read bearer", readIngestSecretFromAuth("Bearer abc123") === "abc123");
ok("read bearer case-insensitive", readIngestSecretFromAuth("bearer abc123") === "abc123");
ok(
  "read basic returns password half",
  readIngestSecretFromAuth(`Basic ${Buffer.from("user:p@ss").toString("base64")}`) === "p@ss",
);
ok(
  "read basic no colon returns whole",
  readIngestSecretFromAuth(`Basic ${Buffer.from("justsecret").toString("base64")}`) === "justsecret",
);
ok("read raw passthrough", readIngestSecretFromAuth("rawsecret") === "rawsecret");
ok("read empty -> null", readIngestSecretFromAuth("") === null);
ok("read non-string -> null", readIngestSecretFromAuth(null) === null);

ok(
  "dedupe key stable for same message-id",
  ingestDedupeKey("postmark", "mid-1") === ingestDedupeKey("postmark", "mid-1"),
);
ok(
  "dedupe key differs by message-id",
  ingestDedupeKey("postmark", "mid-1") !== ingestDedupeKey("postmark", "mid-2"),
);
ok(
  "dedupe key differs by provider",
  ingestDedupeKey("postmark", "mid-1") !== ingestDedupeKey("mailgun", "mid-1"),
);
ok(
  "dedupe falls back when no message-id",
  ingestDedupeKey("postmark", null, "from|tok|123") === ingestDedupeKey("postmark", "", "from|tok|123"),
);
ok("dedupe key is sha256 hex", /^[0-9a-f]{64}$/.test(ingestDedupeKey("p", "m")));

// ===========================================================================
// decideIngest — the composed policy (order + fail-closed)
// ===========================================================================
const baseAccept = {
  channel: "email" as const,
  authenticated: true,
  orgResolved: true,
  from: "noam@royallepage.ca",
  allowlist: ["noam@royallepage.ca"],
  loopHeaders: { from: "noam@royallepage.ca" },
  attachments: [att(JPEG, "image/jpeg", "fridge.jpg")],
};

{
  const d = decideIngest({ ...baseAccept, authenticated: false });
  ok("unauth -> reject 401", d.action === "reject" && d.status === 401);
}
{
  const d = decideIngest({ ...baseAccept, orgResolved: false });
  ok("unknown token -> drop", d.action === "drop" && d.reason === "unknown_token");
}
{
  const d = decideIngest({ ...baseAccept, loopHeaders: { precedence: "bulk" } });
  ok("loop -> drop", d.action === "drop" && d.reason === "loop");
}
{
  const d = decideIngest({ ...baseAccept, from: "stranger@evil.com" });
  ok("unknown sender -> quarantine", d.action === "quarantine" && d.reason === "unknown_sender");
}
{
  const d = decideIngest({ ...baseAccept, attachments: [] });
  ok("no attachment -> drop", d.action === "drop" && d.reason === "no_attachment");
}
{
  const d = decideIngest({ ...baseAccept, attachments: [att(NOTANIMAGE, "application/zip")] });
  ok("bad type -> reject_attachment type", d.action === "reject_attachment" && d.reason === "type");
}
{
  const d = decideIngest(baseAccept);
  ok("all clear -> accept image", d.action === "accept" && d.action === "accept" && d.attachment.parseable === true);
}
{
  // SMS channel uses phone allow-list and ignores loop headers
  const d = decideIngest({
    channel: "sms",
    authenticated: true,
    orgResolved: true,
    from: "+15199158865",
    allowlist: ["+15199158865"],
    attachments: [att(PNG)],
  });
  ok("sms accept via phone allow-list", d.action === "accept");
}
{
  const d = decideIngest({
    channel: "sms",
    authenticated: true,
    orgResolved: true,
    from: "+12025550000",
    allowlist: ["+15199158865"],
    attachments: [att(PNG)],
  });
  ok("sms unknown phone -> quarantine", d.action === "quarantine");
}
{
  // auth checked before everything (a forged POST with a bad sender still 401s)
  const d = decideIngest({ ...baseAccept, authenticated: false, from: "stranger@evil.com" });
  ok("auth precedes sender check", d.action === "reject");
}

// ---------------------------------------------------------------------------
console.log(`\nemail-ingest: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
