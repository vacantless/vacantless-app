// Unit tests for the pure image-URL-import logic (SSRF guard + parsing + image
// sniffing). Run: npx tsx scripts/test-image-url-import.ts
import {
  MAX_IMPORT_URLS,
  parseImageUrls,
  parseIpv4,
  isPrivateOrReservedIpv4,
  isBlockedIpv6,
  isBlockedAddress,
  isBlockedHost,
  validateImageUrl,
  imageTypeFromContentType,
  sniffImageType,
  importUrlErrorMessage,
} from "../lib/image-url-import";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- parseImageUrls --------------------------------------------------------
ok("parse: newline separated", parseImageUrls("a\nb\nc").length === 3);
ok("parse: comma + whitespace separated",
  JSON.stringify(parseImageUrls("a, b   c")) === JSON.stringify(["a", "b", "c"]));
ok("parse: trims and drops blanks", parseImageUrls("\n  x  \n\n").length === 1);
ok("parse: dedupes exact duplicates",
  JSON.stringify(parseImageUrls("x\nx\ny")) === JSON.stringify(["x", "y"]));
ok("parse: preserves order", JSON.stringify(parseImageUrls("c\na\nb")) === JSON.stringify(["c", "a", "b"]));
ok("parse: non-string -> []", parseImageUrls(null).length === 0 && parseImageUrls(undefined).length === 0);
ok("parse: caps at MAX_IMPORT_URLS",
  parseImageUrls(Array.from({ length: MAX_IMPORT_URLS + 20 }, (_, i) => `u${i}`).join("\n")).length === MAX_IMPORT_URLS);

// --- parseIpv4 -------------------------------------------------------------
ok("ipv4: parses dotted quad", JSON.stringify(parseIpv4("192.168.0.1")) === JSON.stringify([192, 168, 0, 1]));
ok("ipv4: rejects >255 octet", parseIpv4("999.1.1.1") === null);
ok("ipv4: rejects non-ip", parseIpv4("example.com") === null);
ok("ipv4: rejects partial", parseIpv4("10.0.0") === null);

// --- isPrivateOrReservedIpv4 ----------------------------------------------
ok("v4 block: 10/8", isPrivateOrReservedIpv4([10, 1, 2, 3]));
ok("v4 block: 127/8 loopback", isPrivateOrReservedIpv4([127, 0, 0, 1]));
ok("v4 block: 169.254 link-local (metadata)", isPrivateOrReservedIpv4([169, 254, 169, 254]));
ok("v4 block: 172.16/12 low", isPrivateOrReservedIpv4([172, 16, 0, 1]));
ok("v4 block: 172.31/12 high", isPrivateOrReservedIpv4([172, 31, 255, 255]));
ok("v4 allow: 172.32 (outside /12)", !isPrivateOrReservedIpv4([172, 32, 0, 1]));
ok("v4 block: 192.168/16", isPrivateOrReservedIpv4([192, 168, 1, 1]));
ok("v4 block: 100.64 CGNAT", isPrivateOrReservedIpv4([100, 64, 0, 1]));
ok("v4 block: 0.0.0.0/8", isPrivateOrReservedIpv4([0, 0, 0, 0]));
ok("v4 block: multicast 224", isPrivateOrReservedIpv4([224, 0, 0, 1]));
ok("v4 block: reserved 240", isPrivateOrReservedIpv4([240, 0, 0, 1]));
ok("v4 block: broadcast 255", isPrivateOrReservedIpv4([255, 255, 255, 255]));
ok("v4 allow: public 8.8.8.8", !isPrivateOrReservedIpv4([8, 8, 8, 8]));
ok("v4 allow: public 1.1.1.1", !isPrivateOrReservedIpv4([1, 1, 1, 1]));
ok("v4 block: malformed length", isPrivateOrReservedIpv4([1, 2, 3]));

// --- isBlockedIpv6 ---------------------------------------------------------
ok("v6 block: loopback ::1", isBlockedIpv6("::1"));
ok("v6 block: unspecified ::", isBlockedIpv6("::"));
ok("v6 block: link-local fe80::1", isBlockedIpv6("fe80::1"));
ok("v6 block: ULA fc00::1", isBlockedIpv6("fc00::1"));
ok("v6 block: ULA fd12::1", isBlockedIpv6("fd12::1"));
ok("v6 block: zone id present", isBlockedIpv6("fe80::1%eth0"));
ok("v6 block: v4-mapped private ::ffff:127.0.0.1", isBlockedIpv6("::ffff:127.0.0.1"));
ok("v6 allow: v4-mapped public ::ffff:8.8.8.8", !isBlockedIpv6("::ffff:8.8.8.8"));
ok("v6 allow: global unicast 2606:4700::1", !isBlockedIpv6("2606:4700::1"));
ok("v6 allow: bracketed global [2606:4700::1]", !isBlockedIpv6("[2606:4700::1]"));
ok("v6 block: unknown shorthand ::dead", isBlockedIpv6("::dead"));
ok("v6 non-literal passes through (no colon)", !isBlockedIpv6("example.com"));

// --- isBlockedAddress (resolved-IP re-check) -------------------------------
ok("addr block: resolved private v4", isBlockedAddress("10.0.0.5"));
ok("addr block: resolved metadata v4", isBlockedAddress("169.254.169.254"));
ok("addr allow: resolved public v4", !isBlockedAddress("93.184.216.34"));
ok("addr block: resolved v6 loopback", isBlockedAddress("::1"));
ok("addr allow: resolved v6 global", !isBlockedAddress("2606:4700:4700::1111"));
ok("addr block: not an IP literal", isBlockedAddress("example.com"));

// --- isBlockedHost ---------------------------------------------------------
ok("host block: localhost", isBlockedHost("localhost"));
ok("host block: *.local", isBlockedHost("printer.local"));
ok("host block: *.internal", isBlockedHost("svc.internal"));
ok("host block: gcp metadata host", isBlockedHost("metadata.google.internal"));
ok("host block: private v4 literal", isBlockedHost("192.168.1.10"));
ok("host block: metadata v4 literal", isBlockedHost("169.254.169.254"));
ok("host block: v6 loopback literal", isBlockedHost("[::1]"));
ok("host block: empty/nullish", isBlockedHost("") && isBlockedHost(null) && isBlockedHost(undefined));
ok("host allow: normal domain", !isBlockedHost("images.example.com"));
ok("host allow: public v4 literal", !isBlockedHost("93.184.216.34"));
ok("host allow: trailing-dot domain", !isBlockedHost("images.example.com."));

// --- validateImageUrl ------------------------------------------------------
ok("url ok: https public", validateImageUrl("https://cdn.example.com/a.jpg").ok === true);
{
  const r = validateImageUrl("https://CDN.Example.com/a.jpg");
  ok("url ok: returns lowercased host + href", r.ok === true && r.host === "cdn.example.com");
}
ok("url ok: http allowed", validateImageUrl("http://example.com/x.png").ok === true);
{
  const r = validateImageUrl("ftp://example.com/x.png");
  ok("url reject: non-http scheme", r.ok === false && r.reason === "scheme");
}
{
  const r = validateImageUrl("file:///etc/passwd");
  ok("url reject: file scheme", r.ok === false && r.reason === "scheme");
}
{
  const r = validateImageUrl("https://user:pass@example.com/a.jpg");
  ok("url reject: embedded credentials", r.ok === false && r.reason === "credentials");
}
{
  const r = validateImageUrl("https://169.254.169.254/latest/meta-data/");
  ok("url reject: metadata host", r.ok === false && r.reason === "host");
}
{
  const r = validateImageUrl("https://localhost:8080/a.jpg");
  ok("url reject: localhost", r.ok === false && r.reason === "host");
}
{
  const r = validateImageUrl("not a url");
  ok("url reject: malformed", r.ok === false && r.reason === "invalid");
}

// --- imageTypeFromContentType ----------------------------------------------
ok("ct: image/jpeg", imageTypeFromContentType("image/jpeg") === "image/jpeg");
ok("ct: image/jpg alias -> jpeg", imageTypeFromContentType("image/jpg") === "image/jpeg");
ok("ct: strips params", imageTypeFromContentType("image/png; charset=binary") === "image/png");
ok("ct: case-insensitive", imageTypeFromContentType("IMAGE/WEBP") === "image/webp");
ok("ct: gif", imageTypeFromContentType("image/gif") === "image/gif");
ok("ct: rejects svg", imageTypeFromContentType("image/svg+xml") === null);
ok("ct: rejects html", imageTypeFromContentType("text/html") === null);
ok("ct: rejects nullish", imageTypeFromContentType(null) === null && imageTypeFromContentType(undefined) === null);

// --- sniffImageType (magic bytes) ------------------------------------------
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const gif87 = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0, 0, 0, 0, 0, 0]);
const gif89 = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const html = new Uint8Array([0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50, 0x45, 0, 0, 0]);
ok("sniff: jpeg", sniffImageType(jpeg) === "image/jpeg");
ok("sniff: png", sniffImageType(png) === "image/png");
ok("sniff: gif87a", sniffImageType(gif87) === "image/gif");
ok("sniff: gif89a", sniffImageType(gif89) === "image/gif");
ok("sniff: webp", sniffImageType(webp) === "image/webp");
ok("sniff: rejects html", sniffImageType(html) === null);
ok("sniff: rejects too-short", sniffImageType(new Uint8Array([0xff, 0xd8])) === null);
ok("sniff: accepts number[] input", sniffImageType([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]) === "image/jpeg");
ok("sniff: a real JPEG header isn't misread as webp", sniffImageType(jpeg) !== "image/webp");

// --- importUrlErrorMessage -------------------------------------------------
ok("msg: urlnone mentions one link per line", /per line/i.test(importUrlErrorMessage("urlnone")));
ok("msg: urlmax mentions limit", /limit/i.test(importUrlErrorMessage("urlmax")));
ok("msg: urlfailed mentions direct", /direct/i.test(importUrlErrorMessage("urlfailed")));
ok("msg: unknown -> generic", /try again/i.test(importUrlErrorMessage("???")));

// --- summary ---------------------------------------------------------------
console.log(`\nimage-url-import: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
