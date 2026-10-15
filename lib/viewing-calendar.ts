// S721: "Add to calendar" for a booked viewing. Pure (no env, no I/O) so it is
// unit-tested in scripts/test-viewing-calendar.ts; the env + database half is
// lib/viewing-calendar-server.ts.
//
// One link per viewing: /showing/calendar/<showingId>.<sig>. The signature is
// an HMAC of the showing id, so the link needs no new column, is the same for
// the renter and the team, and cannot be guessed from a showing id. The page
// offers Google Calendar (a prefilled template link) and Apple / Outlook (an
// .ics file). The file always reflects the viewing as it is now: a moved
// viewing has the new time, a cancelled one comes back STATUS:CANCELLED.

import { createHmac, timingSafeEqual } from "crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIG_LEN = 32;

export function signViewingCalendarToken(showingId: string, secret: string): string {
  const sig = createHmac("sha256", `viewing-calendar:${secret}`)
    .update(showingId.toLowerCase())
    .digest("hex")
    .slice(0, SIG_LEN);
  return `${showingId.toLowerCase()}.${sig}`;
}

/** The showing id when the token is genuine, else null. */
export function verifyViewingCalendarToken(
  token: string | null | undefined,
  secret: string,
): string | null {
  const t = (token ?? "").trim().toLowerCase();
  const dot = t.indexOf(".");
  if (dot < 0) return null;
  const id = t.slice(0, dot);
  if (!UUID_RE.test(id) || !secret) return null;
  const want = Buffer.from(signViewingCalendarToken(id, secret));
  const got = Buffer.from(t);
  if (want.length !== got.length) return null;
  return timingSafeEqual(want, got) ? id : null;
}

export type CalendarViewing = {
  showingId: string;
  startIso: string;
  minutes: number;
  address: string | null;
  orgName: string | null;
  renterName: string | null;
  cancelled: boolean;
  pageUrl: string;
};

export function viewingTitle(v: Pick<CalendarViewing, "address">): string {
  const a = v.address?.trim();
  return a ? `Rental viewing: ${a}` : "Rental viewing";
}

export function viewingDescription(v: CalendarViewing): string {
  const lines: string[] = [];
  if (v.renterName?.trim()) lines.push(`Renter: ${v.renterName.trim()}`);
  if (v.orgName?.trim()) lines.push(`Booked with ${v.orgName.trim()}`);
  lines.push(`Details: ${v.pageUrl}`);
  return lines.join("\n");
}

function endIso(startIso: string, minutes: number): string {
  const m = Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
  return new Date(new Date(startIso).getTime() + m * 60_000).toISOString();
}

/** 2026-10-16T21:00:00.000Z -> 20261016T210000Z */
export function icsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC 5545 line folding: at most 75 octets per line, continuation starts with a space. */
export function icsFold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let curLen = 0;
  let limit = 75;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, "utf8");
    if (curLen + n > limit) {
      parts.push(cur);
      cur = "";
      curLen = 0;
      limit = 74; // the leading space counts
    }
    cur += ch;
    curLen += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

/**
 * The .ics for one viewing. `nowMs` stamps DTSTAMP and SEQUENCE, so a file
 * saved later always wins over an older one with the same UID (a moved or
 * cancelled viewing replaces the earlier copy in Apple and Outlook).
 */
export function buildViewingIcs(v: CalendarViewing, nowMs: number): string {
  const seq = Math.max(0, Math.floor((nowMs - Date.UTC(2026, 0, 1)) / 1000));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Vacantless//Viewing//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:viewing-${v.showingId}@vacantless.com`,
    `DTSTAMP:${icsUtc(new Date(nowMs).toISOString())}`,
    `SEQUENCE:${seq}`,
    `DTSTART:${icsUtc(v.startIso)}`,
    `DTEND:${icsUtc(endIso(v.startIso, v.minutes))}`,
    `SUMMARY:${icsEscape((v.cancelled ? "Cancelled: " : "") + viewingTitle(v))}`,
    ...(v.address?.trim() ? [`LOCATION:${icsEscape(v.address.trim())}`] : []),
    `DESCRIPTION:${icsEscape(viewingDescription(v))}`,
    `URL:${v.pageUrl}`,
    `STATUS:${v.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    ...(v.cancelled
      ? []
      : [
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          "DESCRIPTION:Viewing in 1 hour",
          "TRIGGER:-PT1H",
          "END:VALARM",
        ]),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

export function googleCalendarUrl(v: CalendarViewing): string {
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: viewingTitle(v),
    dates: `${icsUtc(v.startIso)}/${icsUtc(endIso(v.startIso, v.minutes))}`,
    details: viewingDescription(v),
  });
  if (v.address?.trim()) q.set("location", v.address.trim());
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
