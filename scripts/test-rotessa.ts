// Unit tests for the Rotessa connection layer: lib/crypto.ts (AES-256-GCM
// secret encryption) + lib/rotessa.ts pure helpers. The impure pieces
// (testConnection fetch, env-reading encryptSecret/decryptSecret wrappers) are
// excluded — they're covered by the live Test-connection button.
// Run: npx tsx scripts/test-rotessa.ts
import { randomBytes } from "crypto";
import {
  parseKey,
  encryptWithKey,
  decryptWithKey,
} from "../lib/crypto";
import {
  ROTESSA_ENVIRONMENTS,
  isRotessaEnvironment,
  normalizeEnvironment,
  rotessaBaseUrl,
  environmentLabel,
  rotessaAuthHeader,
  validateApiKey,
  maskApiKey,
  classifyConnectionStatus,
} from "../lib/rotessa";

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

function throws(name: string, fn: () => unknown) {
  try {
    fn();
    failed++;
    console.error(`  ✗ ${name} (expected throw)`);
  } catch {
    passed++;
  }
}

// --- crypto: parseKey -------------------------------------------------------
const keyBytes = randomBytes(32);
ok("parseKey accepts base64 32-byte", parseKey(keyBytes.toString("base64")).equals(keyBytes));
ok("parseKey accepts hex 32-byte", parseKey(keyBytes.toString("hex")).equals(keyBytes));
throws("parseKey rejects empty", () => parseKey(""));
throws("parseKey rejects null", () => parseKey(null));
throws("parseKey rejects wrong-length base64", () => parseKey(randomBytes(16).toString("base64")));
throws("parseKey rejects garbage", () => parseKey("not-a-real-key"));

// --- crypto: round-trip -----------------------------------------------------
const key = randomBytes(32);
const secret = 'rotessa_live_key_abc123XYZ="weird"chars';
const ct1 = encryptWithKey(secret, key);
const ct2 = encryptWithKey(secret, key);
ok("roundtrip recovers plaintext", decryptWithKey(ct1, key) === secret);
ok("ciphertext is versioned v1", ct1.startsWith("v1."));
ok("ciphertext has 4 dot-parts", ct1.split(".").length === 4);
ok("same plaintext -> different ciphertext (random IV)", ct1 !== ct2);
ok("both ciphertexts decrypt to same plaintext", decryptWithKey(ct2, key) === secret);
ok("empty-string plaintext roundtrips", decryptWithKey(encryptWithKey("", key), key) === "");

// --- crypto: failure modes --------------------------------------------------
throws("decrypt with wrong key fails (auth tag)", () => decryptWithKey(ct1, randomBytes(32)));
throws("decrypt unknown format fails", () => decryptWithKey("v2.aaa.bbb.ccc", key));
throws("decrypt malformed (too few parts) fails", () => decryptWithKey("v1.aaa.bbb", key));
throws("decrypt empty fails", () => decryptWithKey("", key));
{
  // tamper with the ciphertext body -> auth tag must reject
  const parts = ct1.split(".");
  const tamperedBody = Buffer.from(parts[3], "base64");
  tamperedBody[0] ^= 0xff;
  parts[3] = tamperedBody.toString("base64");
  throws("decrypt detects tampering", () => decryptWithKey(parts.join("."), key));
}

// --- rotessa: environment ---------------------------------------------------
ok("environments are sandbox,live", ROTESSA_ENVIRONMENTS.join(",") === "sandbox,live");
ok("isRotessaEnvironment accepts sandbox", isRotessaEnvironment("sandbox"));
ok("isRotessaEnvironment accepts live", isRotessaEnvironment("live"));
ok("isRotessaEnvironment rejects junk", !isRotessaEnvironment("prod"));
ok("normalizeEnvironment unknown -> sandbox (safe default)", normalizeEnvironment("prod") === "sandbox");
ok("normalizeEnvironment null -> sandbox", normalizeEnvironment(null) === "sandbox");
ok("normalizeEnvironment keeps live", normalizeEnvironment("live") === "live");
ok("base url sandbox", rotessaBaseUrl("sandbox") === "https://sandbox-api.rotessa.com/v1");
ok("base url live", rotessaBaseUrl("live") === "https://api.rotessa.com/v1");
ok("environmentLabel sandbox", environmentLabel("sandbox") === "Sandbox (test)");
ok("environmentLabel live", environmentLabel("live") === "Live");

// --- rotessa: auth header ---------------------------------------------------
ok('auth header is Token token="..."', rotessaAuthHeader("KEY123") === 'Token token="KEY123"');

// --- rotessa: validateApiKey ------------------------------------------------
ok("validateApiKey rejects empty", validateApiKey("") .ok === false);
ok("validateApiKey rejects whitespace-only", validateApiKey("   ").ok === false);
ok("validateApiKey rejects too short", validateApiKey("abc").ok === false);
ok("validateApiKey rejects internal spaces", validateApiKey("abc def ghij").ok === false);
{
  const v = validateApiKey("  validlookingkey123  ");
  ok("validateApiKey trims + accepts", v.ok === true && v.ok && v.value === "validlookingkey123");
}

// --- rotessa: maskApiKey ----------------------------------------------------
ok("maskApiKey empty -> empty", maskApiKey("") === "");
ok("maskApiKey shows last 4", maskApiKey("abcdefghij1234").endsWith("1234"));
ok("maskApiKey hides the head", !maskApiKey("abcdefghij1234").includes("abcdef"));
ok("maskApiKey short -> all dots", maskApiKey("ab") === "••••");

// --- rotessa: classifyConnectionStatus --------------------------------------
ok("200 -> connected ok", classifyConnectionStatus(200).ok === true && classifyConnectionStatus(200).status === "connected");
ok("204 -> connected ok", classifyConnectionStatus(204).ok === true);
ok("401 -> error (key rejected)", classifyConnectionStatus(401).ok === false && classifyConnectionStatus(401).status === "error");
ok("403 -> error", classifyConnectionStatus(403).ok === false);
ok("404 -> error", classifyConnectionStatus(404).ok === false);
ok("500 -> error (unavailable)", classifyConnectionStatus(500).ok === false);
ok("418 -> error (unexpected)", classifyConnectionStatus(418).ok === false);

console.log(`\nrotessa: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
