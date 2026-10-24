// S736 (review item 9, the phone): the signed link a landlord opens on their
// phone to post a rental on Facebook Marketplace without signing in there.
// Same pattern as lib/calendar-feed.ts: the token carries the rental, the
// account and the last day it works, signed with HMAC, so the URL is the only
// secret and nothing is stored. The page it opens shows only what the public
// rental page already shows, plus a box to save the link to the ad.

import { createHmac, timingSafeEqual } from "crypto";
import { MARKETPLACE_PHONE_LINK_DAYS } from "@/lib/marketplace-kit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SIG_LEN = 32;
const DAY_MS = 86_400_000;

export type PhoneKitSubject = { propertyId: string; orgId: string; lastDay: number };

export type PhoneKitCheck =
  | { ok: true; subject: PhoneKitSubject }
  | { ok: false; reason: "bad" | "too_old" };

function sign(body: string, secret: string): string {
  return createHmac("sha256", `marketplace-phone:${secret}`).update(body).digest("hex").slice(0, SIG_LEN);
}

/** "m-<property>-<org>-<last day number>.<sig>"; empty without a secret. */
export function signPhoneKitToken(
  input: { propertyId: string; orgId: string; nowMs: number; days?: number },
  secret: string,
): string {
  if (!secret) return "";
  const days = input.days ?? MARKETPLACE_PHONE_LINK_DAYS;
  const lastDay = Math.floor(input.nowMs / DAY_MS) + days;
  const body = `m-${input.propertyId.toLowerCase()}-${input.orgId.toLowerCase()}-${lastDay}`;
  return `${body}.${sign(body, secret)}`;
}

export function verifyPhoneKitToken(token: string | null | undefined, secret: string, nowMs: number): PhoneKitCheck {
  const t = String(token ?? "").trim().toLowerCase();
  const dot = t.lastIndexOf(".");
  if (dot < 0 || !secret) return { ok: false, reason: "bad" };
  const body = t.slice(0, dot);
  const m = /^m-([0-9a-f-]{36})-([0-9a-f-]{36})-(\d{1,7})$/.exec(body);
  if (!m || !UUID_RE.test(m[1]) || !UUID_RE.test(m[2])) return { ok: false, reason: "bad" };
  const want = Buffer.from(`${body}.${sign(body, secret)}`);
  const got = Buffer.from(t);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: "bad" };
  const lastDay = Number(m[3]);
  if (Math.floor(nowMs / DAY_MS) > lastDay) return { ok: false, reason: "too_old" };
  return { ok: true, subject: { propertyId: m[1], orgId: m[2], lastDay } };
}

/** Server secret for the phone link (the same source as the calendar feed). */
export function phoneKitSecret(env: Record<string, string | undefined> = process.env): string {
  return env.SUPABASE_SERVICE_ROLE_KEY || env.CRON_SECRET || "";
}
