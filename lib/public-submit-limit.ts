// S742b: limits on the public renter form. The form at /r/<id> is open to
// anyone, and each submit emails the landlord, emails the renter, may call the
// AI once and may book a viewing. Without a cap one script floods a landlord's
// inbox and spends the landlord's email and AI budget. These limits are far
// above any real renter's use and fail OPEN: when the counter cannot be read,
// the renter goes through.
import { createHash } from "node:crypto";

export const LIMITS = {
  /** One connection, every rental: 12 submits per 10 minutes. */
  perIp: { window: 600, limit: 12 },
  /** One rental, every connection: 40 submits per hour (a landlord's inbox). */
  perProperty: { window: 3600, limit: 40 },
  /** AI answers per rental per hour (each one costs). */
  aiPerProperty: { window: 3600, limit: 20 },
} as const;

export { HONEYPOT_FIELD, honeypotTripped } from "./public-submit-fields";

/** The caller's address from the proxy headers, or null. Pure. */
export function clientIpFrom(get: (name: string) => string | null): string | null {
  const fwd = get("x-forwarded-for");
  const first = fwd?.split(",")[0]?.trim();
  if (first) return first;
  const real = get("x-real-ip")?.trim();
  return real || null;
}

/** A short, non-reversible key for an address (never store the address). Pure. */
export function ipKey(ip: string | null): string | null {
  if (!ip) return null;
  const salt = process.env.PUBLIC_SUBMIT_SALT || "vacantless";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 24);
}

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * Count one hit against a bucket and say whether it is still under the limit.
 * Fails open: no client, a missing function or a database error all return true.
 */
export async function allowHit(
  admin: RpcClient | null | undefined,
  key: string | null,
  rule: { window: number; limit: number },
): Promise<boolean> {
  if (!admin || !key) return true;
  try {
    const { data, error } = await admin.rpc("public_submit_hit", {
      p_key: key,
      p_window_seconds: rule.window,
      p_limit: rule.limit,
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

/** Both form limits in one call: the connection and the rental. */
export async function allowPublicSubmit(
  admin: RpcClient | null | undefined,
  input: { ip: string | null; propertyId: string },
): Promise<{ allowed: boolean; reason: "ip" | "property" | null }> {
  const ipOk = await allowHit(admin, ipKey(input.ip) && `ip:${ipKey(input.ip)}`, LIMITS.perIp);
  if (!ipOk) return { allowed: false, reason: "ip" };
  const propOk = await allowHit(admin, `prop:${input.propertyId}`, LIMITS.perProperty);
  if (!propOk) return { allowed: false, reason: "property" };
  return { allowed: true, reason: null };
}
