import { getFormatter, getTranslations } from "next-intl/server";
import { Button, Card, StatusBanner } from "@/components/ui";
import { CopyTextButton } from "@/components/copy-text-button";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_INGEST_DOMAIN, ingestAddressFromToken } from "@/lib/email-ingest";
import {
  portalInboxSites,
  summarizePortalInbox,
  type PortalInboxEvent,
  type PortalInboxSiteState,
} from "@/lib/portal-inbox";
import { provisionInquiryAddress } from "./actions";

// S697c. The self-serve half of portal lead ingest: the org's own address, the
// exact senders to make a rule for, whether the rule is working, and Gmail's
// forwarding code. A landlord finishes this without writing to us.

const TONE: Record<PortalInboxSiteState["state"], "success" | "attention" | "neutral"> = {
  working: "success",
  unreadable: "attention",
  unverified: "attention",
  none: "neutral",
};

export async function PortalInboxCard({ orgId }: { orgId: string }) {
  const sites = portalInboxSites();
  if (sites.length === 0) return null;

  const supabase = createClient();
  const [{ data: addr }, { data: eventRows }, t, format] = await Promise.all([
    supabase
      .from("org_ingest_addresses")
      .select("token")
      .eq("organization_id", orgId)
      .eq("channel", "email")
      .eq("active", true)
      .maybeSingle(),
    // Absent until 0227 is applied: the query errors, rows stay empty, and the
    // card still shows the address and the steps.
    supabase
      .from("inbound_portal_events")
      .select("source, outcome, detail, received_at")
      .eq("organization_id", orgId)
      .order("received_at", { ascending: false })
      .limit(50),
    getTranslations("portalInbox"),
    getFormatter(),
  ]);

  const domain = process.env.INGEST_EMAIL_DOMAIN || DEFAULT_INGEST_DOMAIN;
  const address = addr?.token ? ingestAddressFromToken(addr.token as string, domain) : null;
  const now = Date.now();
  const summary = summarizePortalInbox(
    sites,
    ((eventRows ?? []) as PortalInboxEvent[]),
    now,
  );
  const siteNames = format.list(sites.map((s) => s.label), { type: "conjunction" });
  const ago = (iso: string) => format.relativeTime(new Date(iso), new Date(now));

  const stateTitle = (s: PortalInboxSiteState) =>
    s.state === "working" ? t("ready") : s.state === "none" ? t("notYet") : t("needsYou");
  const stateLine = (s: PortalInboxSiteState) => {
    switch (s.state) {
      case "working":
        return t("readyLine", { ago: ago(s.at) });
      case "unreadable":
        return t("unreadableLine", { ago: ago(s.at) });
      case "unverified":
        return t("unverifiedLine", { ago: ago(s.at) });
      default:
        return t("notYetLine");
    }
  };

  return (
    <Card className="space-y-5" padded>
      <div id="inquiries" className="space-y-2">
        <h2 className="text-[length:var(--vl-type-h2)] font-semibold leading-tight text-[var(--vl-text-primary)]">
          {t("title")}
        </h2>
        <p className="text-[length:var(--vl-type-guided-body)] leading-relaxed text-[var(--vl-text-secondary)]">
          {t("sub", { sites: siteNames })}
        </p>
      </div>

      {summary.gmailCode && (
        <StatusBanner tone="info" title={t("gmailCode", { code: summary.gmailCode.code })}>
          <CopyTextButton
            value={summary.gmailCode.code}
            label={t("copy")}
            copiedLabel={t("copied")}
          />
        </StatusBanner>
      )}

      <div className="space-y-2">
        <p className="text-sm font-semibold text-[var(--vl-text-primary)]">{t("addressLabel")}</p>
        {address ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded-lg bg-gray-50 px-3 py-2 text-base text-[var(--vl-text-primary)]">
              {address}
            </code>
            <CopyTextButton value={address} label={t("copy")} copiedLabel={t("copied")} />
          </div>
        ) : (
          <form action={provisionInquiryAddress}>
            <Button type="submit" size="lg">
              {t("getAddress")}
            </Button>
          </form>
        )}
      </div>

      {address && (
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--vl-text-primary)]">{t("howTitle")}</h3>
          <ol className="list-decimal space-y-3 pl-5 text-[length:var(--vl-type-guided-body)] leading-relaxed text-[var(--vl-text-primary)]">
            <li>
              {t("step1")}
              <ul className="mt-2 space-y-1">
                {sites.flatMap((site) =>
                  site.senders.map((sender) => (
                    <li key={sender} className="flex flex-wrap items-center gap-2">
                      <code className="rounded bg-gray-50 px-2 py-0.5 text-sm">{sender}</code>
                      <span className="text-sm text-[var(--vl-text-muted)]">{site.label}</span>
                      <CopyTextButton value={sender} label={t("copy")} copiedLabel={t("copied")} />
                    </li>
                  )),
                )}
              </ul>
            </li>
            <li>{t("step2")}</li>
            <li>{t("step3")}</li>
          </ol>
          <p className="text-base leading-relaxed text-[var(--vl-text-secondary)]">{t("gmailTip")}</p>
        </div>
      )}

      {address && (
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--vl-text-primary)]">{t("statusTitle")}</h3>
          {summary.sites.map((site) => (
            <StatusBanner
              key={site.key}
              tone={TONE[site.status.state]}
              title={`${site.label}: ${stateTitle(site.status)}`}
            >
              {stateLine(site.status)}
            </StatusBanner>
          ))}
        </div>
      )}
    </Card>
  );
}
