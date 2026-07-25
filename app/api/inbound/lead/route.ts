import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_INGEST_DOMAIN,
  pickIngestToken,
  verifyIngestSecret,
  readIngestSecretFromAuth,
  isAllowedSenderEmail,
  isAutoReplyOrLoop,
  type IngestLoopHeaders,
} from "@/lib/email-ingest";
import {
  parsePortalLeadEmail,
  portalLeadNote,
  type ParsedPortalLead,
} from "@/lib/portal-lead-email";
import { sourceLabelForPost } from "@/lib/listing-distribution";
import { notifyOperatorsOfNewLeadById } from "@/lib/notify-new-lead-server";
import {
  isTrustedPortalSender,
  isKnownPortalSender,
  parseInboundAuthResults,
} from "@/lib/portal-senders";

// ============================================================================
// Inbound PORTAL LEAD webhook (S567). The last link in the syndication chain.
//
// Publishing has worked on three channels for weeks and not one lead has ever
// come back, because a renter who inquires on rentals.ca reaches an inbox no
// software reads. Rentals.ca has been emailing tenant leads to the operator
// since November 2025 — 1195 Bruce, 1370 Wyandotte, 1551 Assumption, 833
// Pillette, 50 Glenrose — and every one of them died in a mailbox.
//
// This is a SIBLING of inbound/asset, not a rewrite of it. Every hard,
// security-relevant part is already built and proven in lib/email-ingest and is
// reused verbatim: shared-secret auth, token -> org, the per-org verified-sender
// allow-list, and loop/auto-reply detection. The only new thing is the payload
// handler: a portal parser (lib/portal-lead-email, unit-tested against real
// captured mail) instead of the vision parser.
//
// HOW A LEAD FINDS ITS UNIT, best first. Every step is an EXACT match; none of
// them guesses:
//   1. ad_url from the portal's own payload -> listing_posts.url
//   2. ad id (payload or X-Rentals-Property-ID) -> listing_posts.notes
//   3. the address in the subject -> properties.address, and ONLY when it
//      resolves to exactly one unit in that org
// Steps 1 and 2 only became possible in S567, when the worker started recording
// what it posts. Before that there was nothing on our side to match against.
//
// A lead that matches nothing is still FILED, against the org with no property
// and a note saying why. Losing a renter is worse than filing an untidy row.
//
// WRITING THE LEAD. Where we resolved a property, this calls the same
// submit_public_lead RPC the public /r page uses, so an ingested rentals.ca lead
// is stamped with the same portal source and behaves identically downstream. The
// RPC refuses a unit that is not 'available' ("Listing not available"), which is
// correct for a public form and wrong here: a renter who wrote the day after a
// unit leased is real. That case falls back to a direct insert.
// ============================================================================

export const dynamic = "force-dynamic";

const PROVIDER = "postmark";

/** How far back to look for an identical delivery. A provider retry lands in
 *  seconds; a renter genuinely writing twice about the same unit says something
 *  different, so the message text is part of the comparison rather than time
 *  alone. */
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizeForCompare(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

type ResolvedTarget = {
  propertyId: string | null;
  listingPostId: string | null;
  how: "ad_url" | "ad_id" | "subject_address" | "unresolved" | "other_org";
};

/**
 * Resolve the unit this lead is about, scoped to the org the token resolved to.
 * Never widens past that org: a portal ad id is not globally unique to us, and a
 * cross-org match would be the s566 contact leak in reverse.
 */
async function resolveTarget(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  lead: ParsedPortalLead,
): Promise<ResolvedTarget> {
  if (!admin) return { propertyId: null, listingPostId: null, how: "unresolved" };

  if (lead.adUrl) {
    const { data } = await admin
      .from("listing_posts")
      .select("id, property_id")
      .eq("organization_id", orgId)
      .eq("url", lead.adUrl)
      .neq("status", "removed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.property_id) {
      return {
        propertyId: data.property_id as string,
        listingPostId: data.id as string,
        how: "ad_url",
      };
    }
  }

  if (lead.adId) {
    // The worker writes "rentals_ca listing 1455352 (posted by ...)" into notes.
    const { data } = await admin
      .from("listing_posts")
      .select("id, property_id")
      .eq("organization_id", orgId)
      .eq("portal", "rentals_ca")
      .ilike("notes", `%listing ${lead.adId}%`)
      .neq("status", "removed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.property_id) {
      return {
        propertyId: data.property_id as string,
        listingPostId: data.id as string,
        how: "ad_id",
      };
    }
  }

  if (lead.subjectAddress) {
    // Weakest signal, so it is only trusted when it is unambiguous. The street
    // part before the first comma: subjects read "833 Pillette Road, Windsor, ON".
    const street = lead.subjectAddress.split(",")[0].trim();
    if (street.length >= 5) {
      const { data } = await admin
        .from("properties")
        .select("id")
        .eq("organization_id", orgId)
        .ilike("address", `%${street}%`)
        .limit(2);
      const rows = (data ?? []) as Array<{ id: string }>;
      if (rows.length === 1) {
        return { propertyId: rows[0].id, listingPostId: null, how: "subject_address" };
      }
    }
  }

  // CROSS-ORG GUARD. One portal account can hold ads for several orgs — Noam's
  // single Verified rentals.ca account carries Agile's Windsor listings AND 50
  // Glenrose, which is Abbas's building. So one operator inbox receives lead mail
  // for MORE THAN ONE org, and a blanket forward from it would file another org's
  // renter under the forwarding org. That is the s566 contact leak running in the
  // opposite direction, and it would be just as invisible.
  //
  // So before falling back to "file it unattributed", ask whether this ad is
  // positively someone else's. If it is, refuse: a lead filed under the wrong
  // company is worse than one that bounced, because nobody goes looking for it.
  if (lead.adUrl || lead.adId) {
    let q = admin.from("listing_posts").select("organization_id").neq("status", "removed").limit(1);
    q = lead.adUrl ? q.eq("url", lead.adUrl) : q.ilike("notes", `%listing ${lead.adId}%`);
    const { data: elsewhere } = await q.maybeSingle();
    const ownerOrg = (elsewhere?.organization_id as string | undefined) ?? null;
    if (ownerOrg && ownerOrg !== orgId) {
      return { propertyId: null, listingPostId: null, how: "other_org" };
    }
  }

  return { propertyId: null, listingPostId: null, how: "unresolved" };
}

export async function POST(req: NextRequest) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  const admin = createAdminClient();
  // Unconfigured => dark. Don't reveal the endpoint exists; don't act.
  if (!secret || !admin) {
    return new NextResponse("Not found", { status: 404 });
  }

  // ---- Layer 1: authenticate the webhook (constant-time shared secret) ------
  const authHeader = req.headers.get("authorization");
  const provided =
    readIngestSecretFromAuth(authHeader) ??
    new URL(req.url).searchParams.get("key");
  if (!verifyIngestSecret(provided, secret)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: true, handled: "bad_payload" });
  }

  const str = (v: unknown): string => (typeof v === "string" ? v : "");

  // Recipients: Postmark gives ToFull/CcFull arrays of {Email} + To/Cc strings.
  const recipientStrings: string[] = [];
  for (const key of ["ToFull", "CcFull", "BccFull"]) {
    const arr = payload[key];
    if (Array.isArray(arr)) {
      for (const r of arr) {
        const email =
          r && typeof r === "object" ? str((r as Record<string, unknown>).Email) : "";
        if (email) recipientStrings.push(email);
      }
    }
  }
  for (const key of ["To", "Cc", "OriginalRecipient"]) {
    const s = str(payload[key]);
    if (s) recipientStrings.push(s);
  }

  const ingestDomain = process.env.INGEST_EMAIL_DOMAIN || DEFAULT_INGEST_DOMAIN;
  const token = pickIngestToken(recipientStrings, ingestDomain);

  const fromFull = payload.FromFull;
  const from =
    (fromFull && typeof fromFull === "object"
      ? str((fromFull as Record<string, unknown>).Email)
      : "") || str(payload.From);

  // Header map + the loop/auto-reply subset the pure checker wants.
  const headers: Record<string, string> = {};
  const loopHeaders: IngestLoopHeaders = { from };
  const headerArr = payload.Headers;
  if (Array.isArray(headerArr)) {
    for (const h of headerArr) {
      if (!h || typeof h !== "object") continue;
      const rec = h as Record<string, unknown>;
      const name = str(rec.Name);
      const value = str(rec.Value);
      if (!name) continue;
      headers[name] = value;
      const lower = name.toLowerCase();
      if (lower === "auto-submitted") loopHeaders["auto-submitted"] = value;
      else if (lower === "precedence") loopHeaders.precedence = value;
      else if (lower === "x-autoreply") loopHeaders["x-autoreply"] = value;
      else if (lower === "x-autorespond") loopHeaders["x-autorespond"] = value;
    }
  }
  const replyTo = str(payload.ReplyTo) || headers["Reply-To"] || headers["reply-to"] || null;

  // ---- Layer 2: resolve the org from the token ------------------------------
  let orgId: string | null = null;
  if (token) {
    const { data: addr } = await admin
      .from("org_ingest_addresses")
      .select("organization_id")
      .eq("token", token)
      .eq("active", true)
      .maybeSingle();
    orgId = (addr?.organization_id as string | undefined) ?? null;
  }
  if (!orgId) {
    console.warn("inbound/lead: org not resolved", { hasToken: token != null });
    return NextResponse.json({ ok: true, handled: "org_unresolved" });
  }

  // ---- Layer 3: per-org verified-sender allow-list + loop detection ---------
  // NOTE: deliberately NOT gated on the capture email-in plan entitlement. That
  // gate belongs to the Premium document-capture feature; inbound leads are the
  // core funnel and a plan change must never silently drop a renter.
  const { data: senders } = await admin
    .from("org_ingest_senders")
    .select("address")
    .eq("organization_id", orgId)
    .eq("channel", "email")
    .not("verified_at", "is", null);
  const allowlist = ((senders ?? []) as Array<{ address: unknown }>)
    .map((s) => (typeof s.address === "string" ? s.address : null))
    .filter((a): a is string => a != null);

  if (isAutoReplyOrLoop(loopHeaders)) {
    return NextResponse.json({ ok: true, handled: "auto_reply" });
  }
  // Sender trust, two independent grants (S568 lane B). Either the org verified
  // this sender itself (the "forward from your own email" confirm flow), OR it is
  // a globally-trusted portal system address (contact@rentals.ca, …) whose
  // inbound auth verdict is not a definitive failure. The portal grant is what
  // lets a brand-new org receive portal leads with no per-org sender rows and no
  // hand SQL. The org's ingest token is still the boundary; the cross-org ad
  // guard below is untouched.
  // Sender trust (S568 lane B). A KNOWN portal system address is governed ONLY by
  // the aligned auth guard — never by a legacy per-org allow-list row — so a
  // hand-added contact@rentals.ca can never bypass authentication (Codex P1a).
  // Any other sender uses the org's own verified-sender allow-list (confirm flow).
  const knownPortal = isKnownPortalSender(from);
  if (knownPortal) {
    if (!isTrustedPortalSender(from, headers)) {
      // Enforcement is gated. Until a first real delivery confirms Postmark's auth
      // header shape, run in OBSERVE mode (accept, but log the parsed verdict — not
      // the renter's details) so the first real portal lead is never dropped blind.
      // Flip PORTAL_AUTH_ENFORCE=true to fail-closed once the header is confirmed.
      const enforce = process.env.PORTAL_AUTH_ENFORCE === "true";
      const v = parseInboundAuthResults(headers);
      console.warn("inbound/lead: portal sender failed aligned auth guard", {
        orgResolved: true,
        enforce,
        dkim: v.dkim,
        dkimDomain: v.dkimDomain,
        spf: v.spf,
        spfDomain: v.spfDomain,
        dmarc: v.dmarc,
      });
      if (enforce) {
        return NextResponse.json({ ok: true, handled: "portal_sender_auth_unverified" });
      }
      // observe mode: fall through and file the lead.
    }
  } else if (!isAllowedSenderEmail(from, allowlist)) {
    console.warn("inbound/lead: sender not allowed", { orgResolved: true });
    return NextResponse.json({ ok: true, handled: "sender_not_allowed" });
  }

  // ---- Parse ----------------------------------------------------------------
  const parsed = parsePortalLeadEmail({
    subject: str(payload.Subject),
    from,
    replyTo,
    htmlBody: str(payload.HtmlBody) || null,
    textBody: str(payload.TextBody) || str(payload.StrippedTextReply) || null,
    headers,
  });
  if (!parsed.ok) {
    console.warn("inbound/lead: not parsed", { reason: parsed.reason });
    return NextResponse.json({ ok: true, handled: "not_parsed", reason: parsed.reason });
  }
  const lead = parsed.lead;

  // ---- Resolve the unit -----------------------------------------------------
  const target = await resolveTarget(admin, orgId, lead);
  if (target.how === "other_org") {
    // Logged, not filed. Nothing about the other org goes in the response.
    console.warn("inbound/lead: ad belongs to a different org, refusing", {
      forwardedToOrg: orgId,
      adId: lead.adId,
    });
    return NextResponse.json({ ok: true, handled: "cross_org_refused" });
  }
  const notes = portalLeadNote(lead);

  // ---- Dedupe ---------------------------------------------------------------
  // No ingest_message_key column exists on leads, and adding one is a migration.
  // Until then: same org + same renter + same unit + the same words inside the
  // window is a redelivery, and a renter writing something DIFFERENT about the
  // same unit is a real second lead that must get through.
  if (lead.email || lead.phone) {
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
    let q = admin
      .from("leads")
      .select("id, notes, email, phone, property_id")
      .eq("organization_id", orgId)
      .gte("created_at", since)
      .limit(25);
    if (lead.email) q = q.eq("email", lead.email);
    else if (lead.phone) q = q.eq("phone", lead.phone);
    const { data: recent } = await q;
    const wanted = normalizeForCompare(lead.message);
    const dupe = ((recent ?? []) as Array<{ id: string; notes: string | null; property_id: string | null }>)
      .find(
        (r) =>
          (r.property_id ?? null) === (target.propertyId ?? null) &&
          normalizeForCompare(r.notes).includes(wanted) &&
          wanted.length > 0,
      );
    if (dupe) {
      return NextResponse.json({ ok: true, handled: "duplicate", lead_id: dupe.id });
    }
  }

  // ---- Write ---------------------------------------------------------------
  // The RPC is preferred wherever a property resolved: it stamps leads.source
  // from the tracker's portal exactly as the public /r form does, so an ingested
  // lead and a walled-garden one are indistinguishable downstream.
  if (target.propertyId) {
    const { data: rpcData, error: rpcError } = await admin.rpc("submit_public_lead", {
      p_property_id: target.propertyId,
      p_name: lead.name,
      p_email: lead.email,
      p_phone: lead.phone,
      p_move_in: null,
      p_notes: notes,
      p_listing_post_id: target.listingPostId,
    });
    if (!rpcError) {
      const leadId =
        rpcData && typeof rpcData === "object"
          ? ((rpcData as Record<string, unknown>).lead_id as string | undefined)
          : undefined;
      // Tell the leasing team — the SAME alert a public /r lead fires, routed
      // through the same per-org recipients (S568). Best-effort, never throws.
      if (leadId) {
        await notifyOperatorsOfNewLeadById(admin, {
          orgId,
          leadId,
          propertyAddressFallback: lead.subjectAddress,
        });
      }
      return NextResponse.json({
        ok: true,
        handled: "lead_created",
        via: "submit_public_lead",
        matched_by: target.how,
        confidence: lead.confidence,
        lead_id: leadId ?? null,
      });
    }
    // "Listing not available" is the expected one: the unit leased since the ad
    // went up. Fall through and file it anyway rather than lose the renter.
    console.warn("inbound/lead: rpc refused, filing directly", {
      matched_by: target.how,
      message: rpcError.message,
    });
  }

  const source = target.listingPostId
    ? sourceLabelForPost({ portal: "rentals_ca" })
    : "Rentals.ca";
  const { data: inserted, error: insertError } = await admin
    .from("leads")
    .insert({
      organization_id: orgId,
      property_id: target.propertyId,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      source,
      source_detail: lead.adUrl,
      listing_post_id: target.listingPostId,
      status: "new",
      notes:
        target.propertyId == null
          ? `${notes}\n\nCould not match this to a unit automatically${lead.subjectAddress ? ` (subject said "${lead.subjectAddress}")` : ""}. Assign it by hand.`
          : notes,
    })
    .select("id")
    .maybeSingle();
  if (insertError || !inserted?.id) {
    // A 5xx tells the provider to retry, which is what we want: a lead we failed
    // to store is the one failure mode this endpoint exists to prevent.
    console.error("inbound/lead: insert failed", { message: insertError?.message });
    return new NextResponse("Storage error", { status: 503 });
  }

  // Filed via direct insert — either the RPC refused (unit leased since the ad
  // went up) or the lead matched no unit and was filed unattributed. Notify
  // anyway: an unattributed lead most needs a human to claim and assign it.
  // Best-effort, never throws.
  await notifyOperatorsOfNewLeadById(admin, {
    orgId,
    leadId: inserted.id,
    propertyAddressFallback: lead.subjectAddress,
  });

  return NextResponse.json({
    ok: true,
    handled: "lead_created",
    via: "direct_insert",
    matched_by: target.how,
    confidence: lead.confidence,
    lead_id: inserted.id,
    warnings: lead.warnings,
  });
}
