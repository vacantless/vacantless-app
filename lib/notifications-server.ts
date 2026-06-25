// Server-side orchestration for the per-org customizable NOTIFICATION registry
// (Slice 6 substrate, S327). The pure decisions (which template, which
// recipients, is it on) live in lib/notifications.ts; this is the impure glue
// that reads the per-org override row, renders, and fans the send out.
//
// Client-agnostic, exactly like lib/incident-media-server.ts: pass whichever
// Supabase client matches the caller's auth —
//   * the RLS server client for an OPERATOR transition (cancel/schedule/complete
//     run as the authenticated member; the 0067 policy scopes the settings read
//     to their org), or
//   * the service-role admin client for a TOKEN-driven trade transition
//     (accept/decline/quote on /job/[token]), AFTER the token RPC has re-derived
//     the org server-side. service_role bypasses RLS, so we always filter the
//     settings read by organization_id explicitly.
//
// This function NEVER throws and never returns an error that a caller must
// handle: a notification is a side effect of a transition that already
// succeeded, so a mail failure (or a missing BREVO key) must never fail or
// reverse the transition (the Slice 4 notifyOperatorsOfNewReport posture). It
// also short-circuits silently when the event is off or has no recipients.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getNotificationEvent,
  isEventEnabled,
  renderNotification,
  resolveNotificationAccent,
  resolveNotificationRecipients,
  type NotificationSettingRow,
  type NotificationTokenVars,
} from "./notifications";
import { sendNotificationEmail } from "./email";

// The org branding the branded shell needs. Callers already hold these (the
// operator action from getCurrentOrg; the trade action from its admin org read),
// so we take them rather than re-fetch.
export type NotifyOrg = {
  id: string;
  name: string | null;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
};

export type SendOrgNotificationArgs = {
  client: SupabaseClient;
  org: NotifyOrg;
  eventKey: string;
  vars: NotificationTokenVars;
  // The natural party for a trade/tenant event (always included if present).
  audienceEmail?: string | null;
  // For an operator event with no configured recipients: where it falls back so
  // the alert never silently goes nowhere (e.g. org members with the cap).
  operatorFallback?: string[];
  // Optional CTA rendered as button + plain-text fallback (the "work from your
  // inbox" affordance for email-first operators like Aaliyah).
  action?: { label: string; url: string } | null;
};

export async function sendOrgNotification(args: SendOrgNotificationArgs): Promise<void> {
  try {
    const event = getNotificationEvent(args.eventKey);
    if (!event || !event.active) return;

    // The per-org override (absent == defaults). RLS scopes this for the
    // operator client; the explicit org filter scopes it for the admin client.
    const { data } = await args.client
      .from("notification_settings")
      .select("event_key, enabled, subject_template, body_template, recipients, accent_color")
      .eq("organization_id", args.org.id)
      .eq("event_key", args.eventKey)
      .maybeSingle();
    const setting = (data as NotificationSettingRow | null) ?? null;

    if (!isEventEnabled(setting)) return;

    const recipients = resolveNotificationRecipients({
      audience: event.audience,
      configured: setting?.recipients ?? [],
      audienceEmail: args.audienceEmail,
      operatorFallback: args.operatorFallback,
    });
    if (recipients.length === 0) return;

    const rendered = renderNotification(event, setting, args.vars);
    const accent = resolveNotificationAccent(event, setting);

    await Promise.allSettled(
      recipients.map((to) =>
        sendNotificationEmail({
          to_email: to,
          subject: rendered.subject,
          body: rendered.body,
          action_label: args.action?.label ?? null,
          action_url: args.action?.url ?? null,
          org_name: args.org.name,
          brand_color: args.org.brand_color,
          accent_color: accent,
          logo_url: args.org.logo_url,
          reply_to_email: args.org.reply_to_email,
        }),
      ),
    );
  } catch {
    // Swallow — the transition already happened; a notification is best-effort.
  }
}
