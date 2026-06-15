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

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

// All vacantless.com mail goes out under the one domain-authed sender; the
// per-org identity rides in the display name + reply-to so each customer's
// renters see the customer's brand.
const DEFAULT_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || "leads@vacantless.com";

export type AutoReplyPayload = {
  lead_id: string;
  org_id: string;
  renter_name: string | null;
  renter_email: string | null;
  org_name: string | null;
  brand_color: string | null;
  logo_url: string | null;
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
  const brand = p.brand_color || "#4f46e5";
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
  property_address: string | null;
  when_label: string; // already formatted in the org timezone
};

function bookingHtml(p: BookingPayload): string {
  const brand = p.brand_color || "#4f46e5";
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
      <p style="margin:0 0 16px;">Your showing is confirmed. Here are the details:</p>
      <div style="margin:0 0 16px;padding:16px;border-radius:10px;background:#fafafa;border:1px solid #e4e4e7;">
        <p style="margin:0 0 6px;"><strong>${addr}</strong></p>
        <p style="margin:0;color:#3f3f46;">${when}</p>
      </div>
      <p style="margin:0 0 16px;">If you need to change or cancel, just reply to this email and we'll sort it out.</p>
      <p style="margin:24px 0 0;color:#52525b;">See you then,<br/><strong>${org}</strong></p>
    </div>
    <div style="padding:14px 28px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:12px;color:#a1a1aa;">
      You are receiving this because you booked a showing on our listing page.
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
    ? `Your showing at ${p.property_address} is confirmed`
    : "Your showing is confirmed";

  const body = {
    sender: { name: p.org_name || "Vacantless", email: DEFAULT_SENDER_EMAIL },
    to: [
      {
        email: p.renter_email,
        ...(p.renter_name ? { name: p.renter_name } : {}),
      },
    ],
    replyTo: { email: DEFAULT_SENDER_EMAIL, name: p.org_name || "Vacantless" },
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
    replyTo: { email: DEFAULT_SENDER_EMAIL, name: p.org_name || "Vacantless" },
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
