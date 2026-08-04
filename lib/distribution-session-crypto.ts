// Server-only encrypted channel session storage for distribution_channel_sessions.
// Mirrors the standalone worker's AES-256-GCM envelope so the app can write a
// Facebook Page token and the worker can read it with the same SESSION_ENC_KEY.

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

const TABLE = "distribution_channel_sessions";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export type SessionEnvelope = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
};

function parseSessionEncKey(raw = process.env.SESSION_ENC_KEY): Buffer {
  if (!raw || !raw.trim()) throw new Error("SESSION_ENC_KEY is not set");
  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`SESSION_ENC_KEY must decode to exactly ${KEY_BYTES} bytes`);
  }
  return key;
}

function bufToPgHex(buf: Buffer): string {
  return "\\x" + buf.toString("hex");
}

function pgByteaToBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") {
    const hex = value.startsWith("\\x") ? value.slice(2) : value;
    if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) {
      throw new Error("Invalid bytea hex value");
    }
    return Buffer.from(hex, "hex");
  }
  if (value && typeof value === "object") {
    const data = (value as { data?: unknown }).data;
    if (
      Array.isArray(data) &&
      data.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ) {
      return Buffer.from(data);
    }
  }
  throw new Error("Unsupported bytea value");
}

export function encryptSessionState(
  storageStateJson: string,
  encKey = parseSessionEncKey(),
): SessionEnvelope {
  if (encKey.length !== KEY_BYTES) {
    throw new Error(`SESSION_ENC_KEY must decode to exactly ${KEY_BYTES} bytes`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, encKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(storageStateJson, "utf8"),
    cipher.final(),
  ]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function decryptSessionState(
  env: SessionEnvelope,
  encKey = parseSessionEncKey(),
): string {
  if (encKey.length !== KEY_BYTES) {
    throw new Error(`SESSION_ENC_KEY must decode to exactly ${KEY_BYTES} bytes`);
  }
  const decipher = createDecipheriv(ALGO, encKey, env.iv);
  decipher.setAuthTag(env.authTag);
  return Buffer.concat([
    decipher.update(env.ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

export async function writeChannelSession(args: {
  organizationId: string;
  channel: string;
  storageStateJson: string;
  warmedBy?: string | null;
  expiresAt?: string | null;
  admin?: SupabaseClient | null;
}): Promise<void> {
  const admin = args.admin ?? createAdminClient();
  if (!admin) throw new Error("Supabase service role client is not configured");
  const env = encryptSessionState(args.storageStateJson);
  const nowISO = new Date().toISOString();
  const { error } = await admin.from(TABLE).upsert(
    {
      organization_id: args.organizationId,
      channel: args.channel,
      encrypted_state: bufToPgHex(env.ciphertext),
      iv: bufToPgHex(env.iv),
      auth_tag: bufToPgHex(env.authTag),
      warmed_by: args.warmedBy ?? null,
      expires_at: args.expiresAt ?? null,
      last_validated_at: nowISO,
      updated_at: nowISO,
    },
    { onConflict: "organization_id,channel" },
  );
  if (error) throw new Error(`writeChannelSession failed: ${error.message}`);
}

export async function readChannelSession<T extends object = Record<string, unknown>>(args: {
  organizationId: string;
  channel: string;
  admin?: SupabaseClient | null;
}): Promise<T | null> {
  const admin = args.admin ?? createAdminClient();
  if (!admin) throw new Error("Supabase service role client is not configured");
  const { data, error } = await admin
    .from(TABLE)
    .select("encrypted_state, iv, auth_tag, expires_at")
    .eq("organization_id", args.organizationId)
    .eq("channel", args.channel)
    .maybeSingle();
  if (error) throw new Error(`readChannelSession failed: ${error.message}`);
  if (!data) return null;

  const row = data as {
    encrypted_state: unknown;
    iv: unknown;
    auth_tag: unknown;
    expires_at: string | null;
  };
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    return null;
  }

  // Matches writeChannelSession and the standalone worker AES-256-GCM envelope.
  const decrypted = decryptSessionState({
    ciphertext: pgByteaToBuffer(row.encrypted_state),
    iv: pgByteaToBuffer(row.iv),
    authTag: pgByteaToBuffer(row.auth_tag),
  });
  const parsed = JSON.parse(decrypted) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Channel session payload must be a JSON object");
  }
  return parsed as T;
}

export async function deleteChannelSession(args: {
  organizationId: string;
  channel: string;
  admin?: SupabaseClient | null;
}): Promise<void> {
  const admin = args.admin ?? createAdminClient();
  if (!admin) throw new Error("Supabase service role client is not configured");
  const { error } = await admin
    .from(TABLE)
    .delete()
    .eq("organization_id", args.organizationId)
    .eq("channel", args.channel);
  if (error) throw new Error(`deleteChannelSession failed: ${error.message}`);
}
