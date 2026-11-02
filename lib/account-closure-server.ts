// S742d: what "Close this account" must actually take away. Until now closing
// an account put rentals off market, stamped closed_at, removed logins and
// emailed us, and left in place the encrypted site logins (Kijiji, Zumper,
// Rentals.ca, the Facebook Page token), the Plaid access tokens, the open
// sign-in windows, and the texting number (released only when the daily
// sweep noticed). A closed account should hold none of those. The rows that
// are the landlord's records (renters, tenancies, documents) stay for the
// 30-day deletion promise; the secrets go now.
import { releaseTwilioNumber } from "./texting-numbers-server";

type Admin = {
  from: (table: string) => any;
};

export type SecretsWipeReport = {
  siteLogins: number;
  signinWindows: number;
  bankSecrets: number;
  bankConnections: number;
  channelAccountsPaused: number;
  textingNumber: "released" | "kept" | "none";
  errors: string[];
};

function countOf(data: unknown): number {
  return Array.isArray(data) ? data.length : 0;
}

/** Remove every stored secret and live hook for an org. Never throws. */
export async function wipeOrgSecrets(admin: Admin, orgId: string): Promise<SecretsWipeReport> {
  const report: SecretsWipeReport = {
    siteLogins: 0,
    signinWindows: 0,
    bankSecrets: 0,
    bankConnections: 0,
    channelAccountsPaused: 0,
    textingNumber: "none",
    errors: [],
  };

  // Site logins and the Facebook Page token (both live in channel sessions).
  try {
    const { data, error } = await admin
      .from("distribution_channel_sessions")
      .delete()
      .eq("organization_id", orgId)
      .select("channel");
    if (error) report.errors.push(`sessions:${error.message}`);
    report.siteLogins = countOf(data);
  } catch (e) {
    report.errors.push(`sessions:${String(e)}`);
  }

  // Open sign-in windows (a window the landlord never finished).
  try {
    const { data, error } = await admin
      .from("site_signin_windows")
      .delete()
      .eq("organization_id", orgId)
      .select("id");
    if (error) report.errors.push(`windows:${error.message}`);
    report.signinWindows = countOf(data);
  } catch (e) {
    report.errors.push(`windows:${String(e)}`);
  }

  // Bank feed: the aggregator tokens go; the connection rows read disconnected.
  try {
    const { data: conns, error } = await admin
      .from("bank_connections")
      .select("id")
      .eq("organization_id", orgId);
    if (error) report.errors.push(`bank:${error.message}`);
    const ids = ((conns ?? []) as { id: string }[]).map((c) => c.id);
    if (ids.length > 0) {
      const { data: secrets, error: secErr } = await admin
        .from("bank_connection_secrets")
        .delete()
        .in("connection_id", ids)
        .select("connection_id");
      if (secErr) report.errors.push(`bank_secrets:${secErr.message}`);
      report.bankSecrets = countOf(secrets);
      const { data: upd, error: updErr } = await admin
        .from("bank_connections")
        .update({ status: "disconnected" })
        .in("id", ids)
        .select("id");
      if (updErr) report.errors.push(`bank_connections:${updErr.message}`);
      report.bankConnections = countOf(upd);
    }
  } catch (e) {
    report.errors.push(`bank:${String(e)}`);
  }

  // Posting accounts: nothing may post for a closed account.
  try {
    const { data, error } = await admin
      .from("distribution_channel_accounts")
      .update({ account_status: "paused" })
      .eq("organization_id", orgId)
      .neq("account_status", "paused")
      .select("id");
    if (error) report.errors.push(`accounts:${error.message}`);
    report.channelAccountsPaused = countOf(data);
  } catch (e) {
    report.errors.push(`accounts:${String(e)}`);
  }

  // The texting number: give it back to Twilio now, not when the sweep notices.
  try {
    const { data: num } = await admin
      .from("org_sms_numbers")
      .select("twilio_sid")
      .eq("organization_id", orgId)
      .maybeSingle();
    const sid = (num as { twilio_sid?: string | null } | null)?.twilio_sid ?? null;
    if (sid) {
      if (await releaseTwilioNumber(sid)) {
        await admin.from("org_sms_numbers").delete().eq("organization_id", orgId);
        report.textingNumber = "released";
      } else {
        // The daily texting-numbers sweep retries closed orgs.
        report.textingNumber = "kept";
      }
    }
  } catch (e) {
    report.errors.push(`number:${String(e)}`);
  }

  return report;
}

/** One line for the closure email. Pure. */
export function describeWipe(r: SecretsWipeReport): string {
  const bits = [
    `${r.siteLogins} site login${r.siteLogins === 1 ? "" : "s"} removed`,
    `${r.bankSecrets} bank token${r.bankSecrets === 1 ? "" : "s"} removed`,
    r.textingNumber === "released"
      ? "texting number released"
      : r.textingNumber === "kept"
        ? "texting number NOT released (sweep will retry)"
        : "no texting number",
  ];
  if (r.errors.length > 0) bits.push(`errors: ${r.errors.join("; ")}`);
  return bits.join(", ");
}
