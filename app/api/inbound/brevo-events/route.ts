import { type NextRequest } from "next/server";
import {
  canonicalEvent,
  isUndeliverable,
  parseTags,
  type ParsedEmailTags,
} from "@/lib/email-delivery";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function notFound() {
  return new Response("Not found", { status: 404 });
}

function methodNotAllowed() {
  return new Response("Method not allowed", { status: 405 });
}

function configuredToken(): string | null {
  const token = process.env.BREVO_WEBHOOK_TOKEN?.trim();
  return token ? token : null;
}

// Mirrors the private feed route: compare the whole configured token without an
// early character mismatch exit.
function tokenMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function normalizeEmail(email: string | null): string | null {
  const e = email?.trim().toLowerCase() ?? "";
  return e.includes("@") ? e : null;
}

function occurredAtIso(raw: Record<string, unknown>): string {
  const direct =
    str(raw.date) ?? str(raw.ts) ?? str(raw.timestamp) ?? str(raw.created_at);
  if (direct) {
    const ms = new Date(direct).getTime();
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }

  const tsEvent = raw.ts_event;
  if (typeof tsEvent === "number" && Number.isFinite(tsEvent)) {
    const ms = tsEvent > 10_000_000_000 ? tsEvent : tsEvent * 1000;
    return new Date(ms).toISOString();
  }

  return new Date().toISOString();
}

type ResolvedDeliveryOwner = {
  organizationId: string;
  leadId: string | null;
  showingId: string | null;
};

async function resolveOwner(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  email: string,
  tags: ParsedEmailTags,
): Promise<ResolvedDeliveryOwner | null> {
  let lead: { id: string; organization_id: string } | null = null;
  if (tags.leadId) {
    const { data } = await admin
      .from("leads")
      .select("id, organization_id")
      .eq("id", tags.leadId)
      .maybeSingle();
    lead = (data as { id: string; organization_id: string } | null) ?? null;
  }

  let showing: { id: string; organization_id: string; lead_id: string | null } | null = null;
  if (tags.showingId) {
    const { data } = await admin
      .from("showings")
      .select("id, organization_id, lead_id")
      .eq("id", tags.showingId)
      .maybeSingle();
    showing =
      (data as { id: string; organization_id: string; lead_id: string | null } | null) ??
      null;
  }

  if (lead) {
    const showingId =
      showing && showing.organization_id === lead.organization_id ? showing.id : null;
    return { organizationId: lead.organization_id, leadId: lead.id, showingId };
  }

  if (showing) {
    return {
      organizationId: showing.organization_id,
      leadId: showing.lead_id,
      showingId: showing.id,
    };
  }

  const since = new Date(Date.now() - 60 * 24 * 3_600_000).toISOString();
  const { data } = await admin
    .from("leads")
    .select("id, organization_id")
    .ilike("email", email)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  const fallback =
    (data?.[0] as { id: string; organization_id: string } | undefined) ?? null;
  return fallback
    ? { organizationId: fallback.organization_id, leadId: fallback.id, showingId: null }
    : null;
}

async function handleEvent(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  raw: unknown,
): Promise<boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const event = raw as Record<string, unknown>;
  const email = normalizeEmail(str(event.email) ?? str(event.recipient));
  if (!email) return false;

  const tags = parseTags(event.tags ?? event.tag);
  const canonical = canonicalEvent(str(event.event) ?? "");
  const owner = await resolveOwner(admin, email, tags);
  if (!owner) return false;

  await admin.from("email_delivery_events").insert({
    organization_id: owner.organizationId,
    message_id:
      str(event["message-id"]) ?? str(event.message_id) ?? str(event.messageId),
    email,
    kind: tags.kind ?? "other",
    showing_id: owner.showingId,
    lead_id: owner.leadId,
    event: canonical,
    reason: str(event.reason) ?? str(event.description) ?? str(event["bounce_reason"]),
    occurred_at: occurredAtIso(event),
  });

  if (isUndeliverable(canonical) && tags.leadId) {
    // Intentional read-only touch: do not mutate showings/leads; the dashboard
    // derives the red state from email_delivery_events.
    await admin
      .from("showings")
      .select("id")
      .eq("lead_id", tags.leadId)
      .eq("outcome", "scheduled")
      .limit(10);
  }

  return true;
}

export async function POST(req: NextRequest) {
  const expected = configuredToken();
  if (!expected) return notFound();

  const provided = new URL(req.url).searchParams.get("token") ?? "";
  if (!provided || !tokenMatches(provided, expected)) return notFound();

  const admin = createAdminClient();
  if (!admin) return notFound();

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ ok: true, handled: 0, skipped: "bad_payload" });
  }

  const events = Array.isArray(payload) ? payload : [payload];
  let handled = 0;
  for (const event of events) {
    try {
      if (await handleEvent(admin, event)) handled++;
    } catch {
      // Brevo should not retry-loop because one event was malformed or stale.
    }
  }

  return Response.json({ ok: true, handled });
}

export function GET() {
  return configuredToken() ? methodNotAllowed() : notFound();
}

export function PUT() {
  return configuredToken() ? methodNotAllowed() : notFound();
}

export function PATCH() {
  return configuredToken() ? methodNotAllowed() : notFound();
}

export function DELETE() {
  return configuredToken() ? methodNotAllowed() : notFound();
}
