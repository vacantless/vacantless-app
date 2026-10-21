// S728: a calendar FEED (subscribe once in Google, Apple or Outlook and every
// upcoming viewing appears, moves and cancellations included). One feed per
// account; one per showing agent with only their viewings. Pure half: the
// token and the .ics body. Server half: lib/calendar-feed-server.ts.
//
// The token is signed, so the URL is the only secret. It carries no renter
// phone or email: name, address, time and the viewing's own page link.

import { createHmac, timingSafeEqual } from "crypto";
import { icsEscape, icsFold, icsUtc, type CalendarViewing } from "@/lib/viewing-calendar";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIG_LEN = 32;

export type FeedSubject = { kind: "org"; orgId: string } | { kind: "agent"; orgId: string; agentId: string };

export function signCalendarFeedToken(subject: FeedSubject, secret: string): string {
  const body = subject.kind === "agent" ? `a-${subject.orgId}-${subject.agentId}` : `o-${subject.orgId}`;
  const sig = createHmac("sha256", `calendar-feed:${secret}`).update(body.toLowerCase()).digest("hex").slice(0, SIG_LEN);
  return `${body.toLowerCase()}.${sig}`;
}

export function verifyCalendarFeedToken(token: string | null | undefined, secret: string): FeedSubject | null {
  const t = (token ?? "").trim().toLowerCase().replace(/\.ics$/, "");
  const dot = t.lastIndexOf(".");
  if (dot < 0 || !secret) return null;
  const body = t.slice(0, dot);
  let subject: FeedSubject | null = null;
  const o = /^o-([0-9a-f-]{36})$/.exec(body);
  const a = /^a-([0-9a-f-]{36})-([0-9a-f-]{36})$/.exec(body);
  if (o && UUID_RE.test(o[1])) subject = { kind: "org", orgId: o[1] };
  else if (a && UUID_RE.test(a[1]) && UUID_RE.test(a[2])) subject = { kind: "agent", orgId: a[1], agentId: a[2] };
  if (!subject) return null;
  const want = Buffer.from(signCalendarFeedToken(subject, secret));
  const got = Buffer.from(t);
  if (want.length !== got.length) return null;
  return timingSafeEqual(want, got) ? subject : null;
}

function endIso(startIso: string, minutes: number): string {
  const m = Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
  return new Date(new Date(startIso).getTime() + m * 60_000).toISOString();
}

export type FeedViewing = CalendarViewing & { updatedIso: string | null; agentName?: string | null };

/** The whole feed. Cancelled viewings stay in, marked cancelled, so a calendar removes them. */
export function buildFeedIcs(input: { name: string; viewings: FeedViewing[]; nowMs: number }): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Vacantless//Viewings feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(input.name)}`,
    "X-PUBLISHED-TTL:PT15M",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
  ];
  const stamp = icsUtc(new Date(input.nowMs).toISOString());
  for (const v of input.viewings) {
    // The feed is regenerated on every poll, so a rising SEQUENCE lets a moved
    // or cancelled viewing replace the earlier copy (same rule as the one-off file).
    const seq = Math.max(0, Math.floor(((v.updatedIso ? Date.parse(v.updatedIso) : input.nowMs) - Date.UTC(2026, 0, 1)) / 1000));
    const who = v.renterName?.trim() ? `Viewing: ${v.renterName.trim()}` : "Viewing";
    const where = v.address?.trim() ? ` at ${v.address.trim()}` : "";
    const desc = [
      v.renterName?.trim() ? `Renter: ${v.renterName.trim()}` : null,
      v.agentName?.trim() ? `Showing agent: ${v.agentName.trim()}` : null,
      `Details: ${v.pageUrl}`,
    ].filter(Boolean) as string[];
    lines.push(
      "BEGIN:VEVENT",
      `UID:viewing-${v.showingId}@vacantless.com`,
      `DTSTAMP:${stamp}`,
      `SEQUENCE:${seq}`,
      `DTSTART:${icsUtc(v.startIso)}`,
      `DTEND:${icsUtc(endIso(v.startIso, v.minutes))}`,
      `SUMMARY:${icsEscape((v.cancelled ? "Cancelled: " : "") + who + where)}`,
      ...(v.address?.trim() ? [`LOCATION:${icsEscape(v.address.trim())}`] : []),
      `DESCRIPTION:${icsEscape(desc.join("\n"))}`,
      `URL:${v.pageUrl}`,
      `STATUS:${v.cancelled ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(icsFold).join("\r\n") + "\r\n";
}
