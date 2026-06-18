// Server-only Brevo (transactional) email helper.
//
// Sends the instant branded auto-reply when a public inquiry lands. Reads its
// credentials from server-only env vars and DEGRADES GRACEFULLY: if
// BREVO_API_KEY is not set (or the renter left no email), it simply returns
// { sent: false } and the lead is unaffected. This lets the feature ship now
// and activate the moment the key is added to Vercel — no code change needed.
//
// Brevo account: Vacantless (ad3f79001), domain-authenticated for vacantless.com.
// Generate a v3 API key under SMTP & API → API Keys (NOT the SMTP login used by
// Zapier) and set it in Vercel as BREVO_API_KEY (server-only, no NEXT_PUBLIC_).

import { nurtureCopy, type NurtureCopy } from "@/lib/nurture";
import { TEST_SAMPLE, TEST_SUBJECT_PREFIX } from "@/lib/test-email";
import { DEFAULT_BRAND_COLOR } from "@/lib/brand-theme";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

// All vacantless.com mail goes out under the one domain-authed sender; the
// per-org identity rides in the display name + reply-to so each customer's
// renters see the customer's brand.
const DEFAULT_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || "leads@vacantless.com";

// Public base URL for links we put in emails (e.g. the feedback page). Override
// with NEXT_PUBLIC_APP_URL in Vercel; defaults to the production deployment.
const APP_BASE_URL = (
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app"
).replace(/\/+$/, "");

// The reply-to a renter's reply lands on. Uses the org's configured
// reply_to_email when set; otherwise the shared default sender. Centralized so
// all three senders (auto-reply, booking confirmation, reminder) stay in sync.
function replyToOf(replyToEmail: string | null | undefined, orgName: string | null) {
  return {
    email: replyToEmail || DEFAULT_SENDER_EMAIL,
    name: orgName || "Vacantless",
  };
}

export type AutoReplyPayload = {
  lead_id: string;
  org_id: string;
  renter_name: string | null;
  renter_email: string | null;
  org_name: string | null;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
  property_address: string | null;
  rent_cents: number | null;
  template_subject: string | null;
  template_body: string | null;
};

export type SendResult = { sent: boolean; reason?: string; subject?: string };

function firstName(name: string | null): string {
  if (!name) return "there";
  return name.trim().split(/\s+/)[0] || "there";
}

function formatRent(cents: number | null): string | null {
  if (cents == null) return null;
  return "$" + Math.round(cents / 100).toLocaleString("en-CA") + "/month";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// {{token}} substitution for operator-authored template overrides.
function applyTokens(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) =>
    Object.prototype.hasOwnProperty.call(vars, k.toLowerCase())
      ? vars[k.toLowerCase()]
      : m
  );
}

function defaultSubject(p: AutoReplyPayload): string {
  const org = p.org_name || "the leasing team";
  return p.property_address
    ? `Thanks for your interest in ${p.property_address}`
    : `Thanks for reaching out to ${org}`;
}

function defaultHtml(p: AutoReplyPayload): string {
  const brand = p.brand_color || DEFAULT_BRAND_COLOR;
  const org = escapeHtml(p.org_name || "Our leasing team");
  const hi = escapeHtml(firstName(p.renter_name));
  const addr = p.property_address ? escapeHtml(p.property_address) : null;
  const rent = formatRent(p.rent_cents);

  const propLine = addr
    ? `<p style="margin:0 0 16px;">We received your inquiry about <strong>${addr}</strong>${
        rent ? ` (${escapeHtml(rent)})` : ""
      } and someone from our team will be in touch shortly to arrange a viewing.</p>`
    : `<p style="margin:0 0 16px;">We received your inquiry and someone from our team will be in touch shortly to arrange a viewing.</p>`;

  const logo = p.logo_url
    ? `<img src="${escapeHtml(
        p.logo_url
      )}" alt="${org}" style="max-height:48px;margin-bottom:16px;" />`
    : "";

  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
    <div style="height:6px;background:${escapeHtml(brand)};"></div>
    <div style="padding:28px 28px 24px;">
      ${logo}
      <p style="margin:0 0 16px;font-size:16px;">Hi ${hi},</p>
      ${propLine}
      <p style="margin:0 0 16px;">In the meantime, feel free to reply to this email with any questions. We look forward to helping you find your next home.</p>
      <p style="margin:24px 0 0;color:#52525b;">Warm regards,<br/><strong>${org}</strong></p>
    </div>
    <div style="padding:14px 28px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:12px;color:#a1a1aa;">
      You are receiving this because you submitted an inquiry on our listing page.
    </div>
  </div>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Booking confirmation (M3). Sent when a renter self-books a showing slot.
// ---------------------------------------------------------------------------

export type BookingPayload = {
  lead_id: string;
  renter_name: string | null;
  renter_email: string | null;
  org_name: string | null;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
  property_address: string | null;
  when_label: string; // already formatted in the org timezone
};

function bookingHtml(p: BookingPayload): string {
  const brand = p.brand_color || DEFAULT_BRAND_COLOR;
  const org = escapeHtml(p.org_name || "Our leasing team");
  const hi = escapeHtml(firstName(p.renter_name));
  const addr = p.property_address ? escapeHtml(p.property_address) : "the property";
  const when = escapeHtml(p.when_label);

  const logo = p.logo_url
    ? `<img src="${escapeHtml(
        p.logo_url
      )}" alt="${org}" style="max-height:48px;margin-bottom:16px;" />`
    : "";

  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
    <div style="height:6px;background:${escapeHtml(brand)};"></div>
    <div style="padding:28px 28px 24px;">
      ${logo}
      <p style="margin:0 0 16px;font-size:16px;">Hi ${hi},</p>
      <p style="margin:0 0 16px;">Your viewing is confirmed. Here are the details:</p>
      <div style="margin:0 0 16px;padding:16px;border-radius:10px;background:#fafafa;border:1px solid #e4e4e7;">
        <p style="margin:0 0 6px;"><strong>${addr}</strong></p>
        <p style="margin:0 0 6px;color:#3f3f46;">${when}</p>
        <p style="margin:0;color:#3f3f46;">This is an in-person viewing (not a phone call). Please come to the address above.</p>
      </div>
      <p style="margin:0 0 16px;">If you need to change or cancel, just reply to this email and we'll sort it out.</p>
      <p style="margin:24px 0 0;color:#52525b;">See you then,<br/><strong>${org}</strong></p>
    </div>
    <div style="padding:14px 28px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:12px;color:#a1a1aa;">
      You are receiving this because you booked a viewing on our listing page.
    </div>
  </div>
</body></html>`;
}

/**
 * Best-effort branded booking confirmation. Never throws; returns
 * { sent:false } if BREVO_API_KEY is unset or the renter left no email.
 */
export async function sendBookingConfirmation(
  p: BookingPayload,
): Promise<SendResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { sent: false, reason: "no_api_key" };
  if (!p.renter_email) return { sent: false, reason: "no_renter_email" };

  const subject = p.property_address
    ? `Your viewing at ${p.property_address} is confirmed`
    : "Your viewing is confirmed";

  const body = {
    sender: { name: p.org_name || "Vacantless", email: DEFAULT_SENDER_EMAIL },
    to: [
      {
        email: p.renter_email,
        ...(p.renter_name ? { name: p.renter_name } : {}),
      },
    ],
    replyTo: replyToOf(p.reply_to_email, p.org_name),
    subject,
    htmlContent: bookingHtml(p),
  };

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { sent: false, reason: `brevo_${res.status}:${detail.slice(0, 200)}` };
    }
    return { sent: true, subject };
  } catch (e) {
    return { sent: false, reason: `fetch_error:${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Showing reminder (M3 follow-on). Sent ~24h and ~2h before a booked showing.
// ---------------------------------------------------------------------------

export type ReminderPayload = {
  lead_id: string;
  kind: "24h" | "2h";
  renter_name: string | null;
  renter_email: string | null;
  org_name: string | null;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
  property_address: string | null;
  when_label: string; // already formatted in the org timezone
};

function reminderHtml(p: ReminderPayload): string {
  const brand = p.brand_color || DEFAULT_BRAND_COLOR;
  const org = escapeHtml(p.org_name || "Our leasing team");
  const hi = escapeHtml(firstName(p.renter_name));
  const addr = p.property_address ? escapeHtml(p.property_address) : "the property";
  const when = escapeHtml(p.when_label);

  const lead =
    p.kind === "2h"
      ? "Just a quick reminder - your viewing is coming up soon:"
      : "This is a friendly reminder of your upcoming viewing:";

  const logo = p.logo_url
    ? `<img src="${escapeHtml(
        p.logo_url,
      )}" alt="${org}" style="max-height:48px;margin-bottom:16px;" />`
    : "";

  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
    <div style="height:6px;background:${escapeHtml(brand)};"></div>
    <div style="padding:28px 28px 24px;">
      ${logo}
      <p style="margin:0 0 16px;font-size:16px;">Hi ${hi},</p>
      <p style="margin:0 0 16px;">${lead}</p>
      <div style="margin:0 0 16px;padding:16px;border-radius:10px;background:#fafafa;border:1px solid #e4e4e7;">
        <p style="margin:0 0 6px;"><strong>${addr}</strong></p>
        <p style="margin:0 0 6px;color:#3f3f46;">${when}</p>
        <p style="margin:0;color:#3f3f46;">This is an in-person viewing (not a phone call). Please come to the address above.</p>
      </div>
      <p style="margin:0 0 16px;">If you can no longer make it or need to reschedule, just reply to this email and we'll sort it out.</p>
      <p style="margin:24px 0 0;color:#52525b;">See you then,<br/><strong>${org}</strong></p>
    </div>
    <div style="padding:14px 28px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:12px;color:#a1a1aa;">
      You are receiving this reminder because you booked a viewing on our listing page.
    </div>
  </div>
</body></html>`;
}

/**
 * Best-effort branded showing reminder. Never throws; returns { sent:false }
 * if BREVO_API_KEY is unset or the renter left no email.
 */
export async function sendShowingReminder(p: ReminderPayload): Promise<SendResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { sent: false, reason: "no_api_key" };
  if (!p.renter_email) return { sent: false, reason: "no_renter_email" };

  const subject = p.property_address
    ? `Reminder: your viewing at ${p.property_address}`
    : "Reminder: your upcoming viewing";

  const body = {
    sender: { name: p.org_name || "Vacantless", email: DEFAULT_SENDER_EMAIL },
    to: [
      {
        email: p.renter_email,
        ...(p.renter_name ? { name: p.renter_name } : {}),
      },
    ],
    replyTo: replyToOf(p.reply_to_email, p.org_name),
    subject,
    htmlContent: reminderHtml(p),
  };

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { sent: false, reason: `brevo_${res.status}:${detail.slice(0, 200)}` };
    }
    return { sent: true, subject };
  } catch (e) {
    return { sent: false, reason: `fetch_error:${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Post-showing feedback request (M5). Sent a few hours after an attended
// showing, inviting the renter to rate the visit on the public /f page.
// ---------------------------------------------------------------------------

export type FeedbackPayload = {
  lead_id: string;
  showing_id: string;
  renter_name: string | null;
  renter_email: string | null;
  org_name: string | null;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
  property_address: string | null;
};

function feedbackUrl(showingId: string): string {
  return `${APP_BASE_URL}/f/${encodeURIComponent(showingId)}`;
}

function feedbackHtml(p: FeedbackPayload): string {
  const brand = p.brand_color || DEFAULT_BRAND_COLOR;
  const org = escapeHtml(p.org_name || "Our leasing team");
  const hi = escapeHtml(firstName(p.renter_name));
  const addr = p.property_address ? escapeHtml(p.property_address) : "the property";
  const url = escapeHtml(feedbackUrl(p.showing_id));

  const logo = p.logo_url
    ? `<img src="${escapeHtml(
        p.logo_url,
      )}" alt="${org}" style="max-height:48px;margin-bottom:16px;" />`
    : "";

  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
    <div style="height:6px;background:${escapeHtml(brand)};"></div>
    <div style="padding:28px 28px 24px;">
      ${logo}
      <p style="margin:0 0 16px;font-size:16px;">Hi ${hi},</p>
      <p style="margin:0 0 16px;">Thanks for visiting <strong>${addr}</strong>. How was your viewing? It only takes a few seconds and helps us serve you better.</p>
      <p style="margin:0 0 24px;text-align:center;">
        <a href="${url}" style="display:inline-block;background:${escapeHtml(
          brand,
        )};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Leave quick feedback</a>
      </p>
      <p style="margin:0 0 16px;font-size:13px;color:#71717a;">Or paste this link into your browser:<br/><span style="color:#52525b;">${url}</span></p>
      <p style="margin:24px 0 0;color:#52525b;">Thank you,<br/><strong>${org}</strong></p>
    </div>
    <div style="padding:14px 28px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:12px;color:#a1a1aa;">
      You are receiving this because you attended a viewing with us.
    </div>
  </div>
</body></html>`;
}

/**
 * Best-effort branded post-showing feedback request. Never throws; returns
 * { sent:false } if BREVO_API_KEY is unset or the renter left no email.
 */
export async function sendFeedbackRequest(p: FeedbackPayload): Promise<SendResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { sent: false, reason: "no_api_key" };
  if (!p.renter_email) return { sent: false, reason: "no_renter_email" };

  const subject = p.property_address
    ? `How was your viewing at ${p.property_address}?`
    : "How was your viewing?";

  const body = {
    sender: { name: p.org_name || "Vacantless", email: DEFAULT_SENDER_EMAIL },
    to: [
      {
        email: p.renter_email,
        ...(p.renter_name ? { name: p.renter_name } : {}),
      },
    ],
    replyTo: replyToOf(p.reply_to_email, p.org_name),
    subject,
    htmlContent: feedbackHtml(p),
  };

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { sent: false, reason: `brevo_${res.status}:${detail.slice(0, 200)}` };
    }
    return { sent: true, subject };
  } catch (e) {
    return { sent: false, reason: `fetch_error:${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Price-drop blast (M5). Sent to still-open leads on a property after the
// operator lowers its rent: "the price just dropped — still interested?".
// ---------------------------------------------------------------------------

export type PriceDropPayload = {
  lead_id: string;
  property_id: string;
  renter_name: string | null;
  renter_email: string | null;
  org_name: string | null;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
  property_address: string | null;
  new_rent_cents: number | null;
  old_rent_cents: number | null;
};

function listingUrl(propertyId: string): string {
  return `${APP_BASE_URL}/r/${encodeURIComponent(propertyId)}`;
}

function priceDropHtml(p: PriceDropPayload): string {
  const brand = p.brand_color || DEFAULT_BRAND_COLOR;
  const org = escapeHtml(p.org_name || "Our leasing team");
  const hi = escapeHtml(firstName(p.renter_name));
  const addr = p.property_address ? escapeHtml(p.property_address) : "the property";
  const url = escapeHtml(listingUrl(p.property_id));
  const newRent = formatRent(p.new_rent_cents);
  const oldRent = formatRent(p.old_rent_cents);

  const logo = p.logo_url
    ? `<img src="${escapeHtml(
        p.logo_url,
      )}" alt="${org}" style="max-height:48px;margin-bottom:16px;" />`
    : "";

  // Show "was → now" when we have a credible prior price above the new one.
  const showWas =
    p.old_rent_cents != null &&
    p.new_rent_cents != null &&
    p.old_rent_cents > p.new_rent_cents;

  const priceBlock = newRent
    ? `<div style="margin:0 0 16px;padding:16px;border-radius:10px;background:#fafafa;border:1px solid #e4e4e7;text-align:center;">
        <p style="margin:0 0 6px;"><strong>${addr}</strong></p>
        ${
          showWas && oldRent
            ? `<p style="margin:0;font-size:18px;"><span style="color:#a1a1aa;text-decoration:line-through;">${escapeHtml(
                oldRent,
              )}</span> &nbsp;<strong style="color:${escapeHtml(
                brand,
              )};">${escapeHtml(newRent)}</strong></p>`
            : `<p style="margin:0;font-size:18px;"><strong style="color:${escapeHtml(
                brand,
              )};">${escapeHtml(newRent)}</strong></p>`
        }
      </div>`
    : `<div style="margin:0 0 16px;padding:16px;border-radius:10px;background:#fafafa;border:1px solid #e4e4e7;text-align:center;">
        <p style="margin:0;"><strong>${addr}</strong></p>
      </div>`;

  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
    <div style="height:6px;background:${escapeHtml(brand)};"></div>
    <div style="padding:28px 28px 24px;">
      ${logo}
      <p style="margin:0 0 16px;font-size:16px;">Hi ${hi},</p>
      <p style="margin:0 0 16px;">Good news - the price just dropped on a home you were interested in. It may still be available:</p>
      ${priceBlock}
      <p style="margin:0 0 24px;text-align:center;">
        <a href="${url}" style="display:inline-block;background:${escapeHtml(
          brand,
        )};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">See it & book a viewing</a>
      </p>
      <p style="margin:0 0 16px;font-size:13px;color:#71717a;">Or paste this link into your browser:<br/><span style="color:#52525b;">${url}</span></p>
      <p style="margin:24px 0 0;color:#52525b;">Talk soon,<br/><strong>${org}</strong></p>
    </div>
    <div style="padding:14px 28px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:12px;color:#a1a1aa;">
      You are receiving this because you inquired about this listing with us.
    </div>
  </div>
</body></html>`;
}

/**
 * Best-effort branded price-drop alert. Never throws; returns { sent:false }
 * if BREVO_API_KEY is unset or the lead left no email.
 */
export async function sendPriceDropAlert(p: PriceDropPayload): Promise<SendResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { sent: false, reason: "no_api_key" };
  if (!p.renter_email) return { sent: false, reason: "no_renter_email" };

  const newRent = formatRent(p.new_rent_cents);
  const subject = p.property_address
    ? `Price drop at ${p.property_address}${newRent ? ` - now ${newRent}` : ""}`
    : "A home you were interested in just dropped in price";

  const body = {
    sender: { name: p.org_name || "Vacantless", email: DEFAULT_SENDER_EMAIL },
    to: [
      {
        email: p.renter_email,
        ...(p.renter_name ? { name: p.renter_name } : {}),
      },
    ],
    replyTo: replyToOf(p.reply_to_email, p.org_name),
    subject,
    htmlContent: priceDropHtml(p),
  };

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { sent: false, reason: `brevo_${res.status}:${detail.slice(0, 200)}` };
    }
    return { sent: true, subject };
  } catch (e) {
    return { sent: false, reason: `fetch_error:${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Nurture drip (M5). A short, paced sequence of branded follow-ups to a renter
// who inquired but hasn't booked a showing yet. The per-step copy lives in
// lib/nurture (pure + tested); this composer wraps it in the branded card and
// links back to the listing to book.
// ---------------------------------------------------------------------------

export type NurturePayload = {
  lead_id: string;
  property_id: string | null;
  step: number;
  renter_name: string | null;
  renter_email: string | null;
  org_name: string | null;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
  property_address: string | null;
  rent_cents: number | null;
};

function nurtureHtml(p: NurturePayload, copy: NurtureCopy): string {
  const brand = p.brand_color || DEFAULT_BRAND_COLOR;
  const org = escapeHtml(p.org_name || "Our leasing team");
  const hi = escapeHtml(firstName(p.renter_name));
  const addr = p.property_address ? escapeHtml(p.property_address) : null;
  const rent = formatRent(p.rent_cents);
  const lead = escapeHtml(copy.lead);
  const ctaLabel = escapeHtml(copy.cta);

  const logo = p.logo_url
    ? `<img src="${escapeHtml(
        p.logo_url,
      )}" alt="${org}" style="max-height:48px;margin-bottom:16px;" />`
    : "";

  // Property card (address + rent) when we know which listing.
  const propBlock = addr
    ? `<div style="margin:0 0 16px;padding:16px;border-radius:10px;background:#fafafa;border:1px solid #e4e4e7;text-align:center;">
        <p style="margin:0 0 6px;"><strong>${addr}</strong></p>
        ${
          rent
            ? `<p style="margin:0;font-size:16px;color:${escapeHtml(
                brand,
              )};"><strong>${escapeHtml(rent)}</strong></p>`
            : ""
        }
      </div>`
    : "";

  // CTA only when we have a listing to point at; otherwise invite a reply.
  const cta = p.property_id
    ? `<p style="margin:0 0 24px;text-align:center;">
        <a href="${escapeHtml(listingUrl(p.property_id))}" style="display:inline-block;background:${escapeHtml(
          brand,
        )};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">${ctaLabel}</a>
      </p>
      <p style="margin:0 0 16px;font-size:13px;color:#71717a;">Or paste this link into your browser:<br/><span style="color:#52525b;">${escapeHtml(
        listingUrl(p.property_id),
      )}</span></p>`
    : `<p style="margin:0 0 16px;">Just reply to this email and we'll help you set up a time.</p>`;

  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
    <div style="height:6px;background:${escapeHtml(brand)};"></div>
    <div style="padding:28px 28px 24px;">
      ${logo}
      <p style="margin:0 0 16px;font-size:16px;">Hi ${hi},</p>
      <p style="margin:0 0 16px;">${lead}</p>
      ${propBlock}
      ${cta}
      <p style="margin:24px 0 0;color:#52525b;">Talk soon,<br/><strong>${org}</strong></p>
    </div>
    <div style="padding:14px 28px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:12px;color:#a1a1aa;">
      You are receiving this because you inquired about a listing with us. Reply
      STOP and we won't follow up again.
    </div>
  </div>
</body></html>`;
}

/**
 * Best-effort branded nurture email. Never throws; returns { sent:false } if
 * BREVO_API_KEY is unset or the lead left no email.
 */
export async function sendNurtureEmail(p: NurturePayload): Promise<SendResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { sent: false, reason: "no_api_key" };
  if (!p.renter_email) return { sent: false, reason: "no_renter_email" };

  const copy = nurtureCopy(p.step);
  const subject = p.property_address
    ? `${copy.subject} - ${p.property_address}`
    : copy.subject;

  const body = {
    sender: { name: p.org_name || "Vacantless", email: DEFAULT_SENDER_EMAIL },
    to: [
      {
        email: p.renter_email,
        ...(p.renter_name ? { name: p.renter_name } : {}),
      },
    ],
    replyTo: replyToOf(p.reply_to_email, p.org_name),
    subject,
    htmlContent: nurtureHtml(p, copy),
  };

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { sent: false, reason: `brevo_${res.status}:${detail.slice(0, 200)}` };
    }
    return { sent: true, subject };
  } catch (e) {
    return { sent: false, reason: `fetch_error:${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Settings "Send a test email". Emails the operator a copy of the branded
// renter auto-reply (using their own saved branding + realistic sample data) so
// they can confirm deliverability and how their brand looks before sharing the
// intake link. Reuses the same Brevo plumbing — no new credentials.
// ---------------------------------------------------------------------------

export type TestEmailPayload = {
  to_email: string;
  org_name: string | null;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
};

/**
 * Best-effort branded test email. Never throws; returns { sent:false } with a
 * reason ("no_api_key" / "no_recipient" / "brevo_*" / "fetch_error") so the
 * caller can show the operator an accurate message.
 */
export async function sendTestEmail(p: TestEmailPayload): Promise<SendResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { sent: false, reason: "no_api_key" };
  if (!p.to_email) return { sent: false, reason: "no_recipient" };

  // Build the exact default auto-reply a real renter would get, with sample
  // renter/listing data, so the operator sees a faithful preview.
  const sample: AutoReplyPayload = {
    lead_id: "test",
    org_id: "test",
    renter_name: TEST_SAMPLE.renter_name,
    renter_email: p.to_email,
    org_name: p.org_name,
    brand_color: p.brand_color,
    logo_url: p.logo_url,
    reply_to_email: p.reply_to_email,
    property_address: TEST_SAMPLE.property_address,
    rent_cents: TEST_SAMPLE.rent_cents,
    template_subject: null,
    template_body: null,
  };

  const subject = `${TEST_SUBJECT_PREFIX}${defaultSubject(sample)}`;

  const body = {
    sender: { name: p.org_name || "Vacantless", email: DEFAULT_SENDER_EMAIL },
    to: [{ email: p.to_email }],
    replyTo: replyToOf(p.reply_to_email, p.org_name),
    subject,
    htmlContent: defaultHtml(sample),
  };

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { sent: false, reason: `brevo_${res.status}:${detail.slice(0, 200)}` };
    }
    return { sent: true, subject };
  } catch (e) {
    return { sent: false, reason: `fetch_error:${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Tenant message (platform pivot step 3). A landlord-authored one-off / template
// message to a tenant on a tenancy (rent reminder, maintenance notice, general
// update). The token substitution + validation live in lib/tenant-comms (pure +
// tested); this composer wraps the already-rendered plain-text body in the same
// branded card as the renter mail and sends it under the org's identity (display
// name + reply-to over the one domain-authed sender — the DMARC-safe pattern).
// ---------------------------------------------------------------------------

export type TenantMessagePayload = {
  tenant_email: string; // already validated non-empty by the caller
  tenant_name: string | null;
  org_name: string | null;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
  subject: string; // already token-rendered
  body: string; // already token-rendered PLAIN TEXT (we escape + <br> it)
};

// Render the operator's plain-text body safely into the branded card: escape
// HTML, then turn newlines into paragraph breaks so their formatting survives.
function tenantMessageBodyHtml(body: string): string {
  const paragraphs = body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) =>
      escapeHtml(block.trim()).replace(/\n/g, "<br/>"),
    )
    .filter((b) => b.length > 0);
  return paragraphs
    .map((p) => `<p style="margin:0 0 16px;">${p}</p>`)
    .join("");
}

function tenantMessageHtml(p: TenantMessagePayload): string {
  const brand = p.brand_color || DEFAULT_BRAND_COLOR;
  const org = escapeHtml(p.org_name || "Your property manager");
  const logo = p.logo_url
    ? `<img src="${escapeHtml(
        p.logo_url,
      )}" alt="${org}" style="max-height:48px;margin-bottom:16px;" />`
    : "";

  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
    <div style="height:6px;background:${escapeHtml(brand)};"></div>
    <div style="padding:28px 28px 24px;">
      ${logo}
      ${tenantMessageBodyHtml(p.body)}
      <p style="margin:24px 0 0;color:#52525b;">- <strong>${org}</strong></p>
    </div>
    <div style="padding:14px 28px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:12px;color:#a1a1aa;">
      You are receiving this because you are a tenant of ${org}. Reply to this
      email to reach us.
    </div>
  </div>
</body></html>`;
}

/**
 * Best-effort branded tenant message. Never throws; returns { sent:false } if
 * BREVO_API_KEY is unset or the tenant has no email.
 */
export async function sendTenantMessageEmail(
  p: TenantMessagePayload,
): Promise<SendResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { sent: false, reason: "no_api_key" };
  if (!p.tenant_email) return { sent: false, reason: "no_tenant_email" };

  const body = {
    sender: { name: p.org_name || "Vacantless", email: DEFAULT_SENDER_EMAIL },
    to: [
      {
        email: p.tenant_email,
        ...(p.tenant_name ? { name: p.tenant_name } : {}),
      },
    ],
    replyTo: replyToOf(p.reply_to_email, p.org_name),
    subject: p.subject,
    htmlContent: tenantMessageHtml(p),
  };

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { sent: false, reason: `brevo_${res.status}:${detail.slice(0, 200)}` };
    }
    return { sent: true, subject: p.subject };
  } catch (e) {
    return { sent: false, reason: `fetch_error:${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Lease signature request (lease vault #11, slice 4). Sent to a signer (tenant
// or landlord) when the operator sends a generated lease out for signature.
// Links to the public /sign/{token} magic-link page (no account needed — the
// Tenon10/SkySlope pattern). Best-effort + degrades gracefully like the rest.
// ---------------------------------------------------------------------------

export type LeaseSignaturePayload = {
  signer_email: string; // already validated non-empty by the caller
  signer_name: string | null;
  token: string;
  org_name: string | null;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
  property_address: string | null;
};

function signUrl(token: string): string {
  return `${APP_BASE_URL}/sign/${encodeURIComponent(token)}`;
}

function leaseSignatureHtml(p: LeaseSignaturePayload): string {
  const brand = p.brand_color || DEFAULT_BRAND_COLOR;
  const org = escapeHtml(p.org_name || "Your property manager");
  const hi = escapeHtml(firstName(p.signer_name));
  const addr = p.property_address ? escapeHtml(p.property_address) : "your new home";
  const url = escapeHtml(signUrl(p.token));

  const logo = p.logo_url
    ? `<img src="${escapeHtml(
        p.logo_url,
      )}" alt="${org}" style="max-height:48px;margin-bottom:16px;" />`
    : "";

  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
    <div style="height:6px;background:${escapeHtml(brand)};"></div>
    <div style="padding:28px 28px 24px;">
      ${logo}
      <p style="margin:0 0 16px;font-size:16px;">Hi ${hi},</p>
      <p style="margin:0 0 16px;">Your lease for <strong>${addr}</strong> is ready for your signature. Please review the full document and sign electronically — it only takes a minute, and no account is needed.</p>
      <p style="margin:0 0 24px;text-align:center;">
        <a href="${url}" style="display:inline-block;background:${escapeHtml(
          brand,
        )};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Review &amp; sign your lease</a>
      </p>
      <p style="margin:0 0 16px;font-size:13px;color:#71717a;">Or paste this link into your browser:<br/><span style="color:#52525b;">${url}</span></p>
      <p style="margin:24px 0 0;color:#52525b;">Thank you,<br/><strong>${org}</strong></p>
    </div>
    <div style="padding:14px 28px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:12px;color:#a1a1aa;">
      You are receiving this because ${org} prepared a lease for you to sign. This link is unique to you — please don't forward it.
    </div>
  </div>
</body></html>`;
}

/**
 * Best-effort branded lease-signature request. Never throws; returns
 * { sent:false } if BREVO_API_KEY is unset or the signer has no email.
 */
export async function sendLeaseSignatureRequest(
  p: LeaseSignaturePayload,
): Promise<SendResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { sent: false, reason: "no_api_key" };
  if (!p.signer_email) return { sent: false, reason: "no_signer_email" };

  const subject = p.property_address
    ? `Please sign your lease for ${p.property_address}`
    : "Please sign your lease";

  const body = {
    sender: { name: p.org_name || "Vacantless", email: DEFAULT_SENDER_EMAIL },
    to: [
      {
        email: p.signer_email,
        ...(p.signer_name ? { name: p.signer_name } : {}),
      },
    ],
    replyTo: replyToOf(p.reply_to_email, p.org_name),
    subject,
    htmlContent: leaseSignatureHtml(p),
  };

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { sent: false, reason: `brevo_${res.status}:${detail.slice(0, 200)}` };
    }
    return { sent: true, subject };
  } catch (e) {
    return { sent: false, reason: `fetch_error:${(e as Error).message}` };
  }
}

/**
 * Best-effort branded auto-reply. Never throws — callers can ignore the result.
 */
export async function sendAutoReply(p: AutoReplyPayload): Promise<SendResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { sent: false, reason: "no_api_key" };
  if (!p.renter_email) return { sent: false, reason: "no_renter_email" };

  const vars: Record<string, string> = {
    renter_name: firstName(p.renter_name),
    org_name: p.org_name || "our team",
    property_address: p.property_address || "the property",
    rent: formatRent(p.rent_cents) || "",
  };

  const subject = p.template_subject
    ? applyTokens(p.template_subject, vars)
    : defaultSubject(p);

  // Operator template body is treated as HTML (they author it); otherwise the
  // branded default. Token-substitute either way.
  const htmlContent = p.template_body
    ? applyTokens(p.template_body, vars)
    : defaultHtml(p);

  const body = {
    sender: { name: p.org_name || "Vacantless", email: DEFAULT_SENDER_EMAIL },
    to: [
      {
        email: p.renter_email,
        ...(p.renter_name ? { name: p.renter_name } : {}),
      },
    ],
    replyTo: replyToOf(p.reply_to_email, p.org_name),
    subject,
    htmlContent,
  };

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      // Don't let a slow provider hang the request indefinitely.
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { sent: false, reason: `brevo_${res.status}:${detail.slice(0, 200)}` };
    }
    return { sent: true, subject };
  } catch (e) {
    return { sent: false, reason: `fetch_error:${(e as Error).message}` };
  }
}
