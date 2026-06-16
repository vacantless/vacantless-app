// Server-only symmetric encryption for secrets we must store at rest (today:
// the landlord's Rotessa API token). App-level AES-256-GCM — the database only
// ever holds opaque ciphertext, and the key lives in a server env var, never in
// the DB. So a DB read (or a leaked backup) does not expose the secret.
//
// Key: ROTESSA_ENC_KEY in Vercel (server-only, NO NEXT_PUBLIC_). 32 bytes,
// supplied as base64 (44 chars) or hex (64 chars). Generate one with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//
// Ciphertext format (single self-describing string, safe to store in a text
// column): "v1.<iv_b64>.<tag_b64>.<ciphertext_b64>". The version prefix lets us
// rotate the scheme later without ambiguity.
//
// The pure parts (key parsing, format parse/serialize, round-trip with an
// explicit key) are unit-tested in scripts/test-rotessa.ts; the env-reading
// wrappers are the only impure surface.

import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const SCHEME = "v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32; // AES-256

/**
 * Parse a 32-byte key from a base64 or hex string. Throws on a wrong-length or
 * unparseable key so a misconfigured env fails loud at use-time (not silently
 * encrypting with a bad key).
 */
export function parseKey(raw: string | null | undefined): Buffer {
  if (!raw || !raw.trim()) {
    throw new Error("ROTESSA_ENC_KEY is not set");
  }
  const s = raw.trim();
  let buf: Buffer | null = null;

  // hex: exactly 64 hex chars
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    buf = Buffer.from(s, "hex");
  } else {
    // otherwise treat as base64 (also accepts base64url)
    try {
      buf = Buffer.from(s, "base64");
    } catch {
      buf = null;
    }
  }

  if (!buf || buf.length !== KEY_BYTES) {
    throw new Error(
      `ROTESSA_ENC_KEY must be 32 bytes (got ${buf ? buf.length : 0}); supply base64 (44 chars) or hex (64 chars)`,
    );
  }
  return buf;
}

/**
 * Encrypt plaintext with an explicit 32-byte key. Returns the self-describing
 * "v1.<iv>.<tag>.<ct>" string. A fresh random IV per call means encrypting the
 * same plaintext twice yields different ciphertext (no equality leak).
 */
export function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    SCHEME,
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(".");
}

/**
 * Decrypt a "v1.<iv>.<tag>.<ct>" string with an explicit key. Throws if the
 * format is wrong, the scheme is unknown, or the auth tag fails (tampering /
 * wrong key). Callers should treat any throw as "secret unavailable".
 */
export function decryptWithKey(payload: string, key: Buffer): string {
  if (!payload) throw new Error("nothing to decrypt");
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== SCHEME) {
    throw new Error("unrecognized ciphertext format");
  }
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ct = Buffer.from(parts[3], "base64");
  if (iv.length !== IV_BYTES) throw new Error("bad IV length");

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

// ---------------------------------------------------------------------------
// Env-reading wrappers (the impure surface). Read the key lazily so importing
// this module never throws — only an actual encrypt/decrypt call requires the
// env var to be present and well-formed.
// ---------------------------------------------------------------------------

export function encryptSecret(plaintext: string): string {
  return encryptWithKey(plaintext, parseKey(process.env.ROTESSA_ENC_KEY));
}

export function decryptSecret(payload: string): string {
  return decryptWithKey(payload, parseKey(process.env.ROTESSA_ENC_KEY));
}

/** True if a usable ROTESSA_ENC_KEY is configured (for the settings UI to warn). */
export function encryptionConfigured(): boolean {
  try {
    parseKey(process.env.ROTESSA_ENC_KEY);
    return true;
  } catch {
    return false;
  }
}
