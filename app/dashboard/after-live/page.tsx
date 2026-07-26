import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { setLocaleFromFormData } from "@/app/i18n/actions";
import {
  BackNext,
  Button,
  Card,
  LanguageDropdown,
  StageShell,
  StatusBanner,
  StatusChip,
} from "@/components/ui";
import { channelByKey } from "@/lib/distribution-channels";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { assertSupportedLocale } from "@/lib/i18n/locale";
import { stage4BadgeKey } from "@/lib/stage4-after-live";
import type { AfterLiveSummary } from "@/lib/after-live-summary";
import { propertyAfterLiveSummary } from "../properties/actions";

export const dynamic = "force-dynamic";

// Stage 4 "After it is live" (S585). DARK: new route, not linked from any nav.
// Guided density on the S583a kit. The wizard step is a one-time "here is what
// happens next" preview — the durable leads + take-down monitoring wires the
// same read-model into the property view (a later slice). The mark-leased
// button is PREVIEW ONLY here; the real mark-leased + take-down action lives in
// the property view, gated by LEASEUP_TAKEDOWN_ENABLED.
export default async function AfterLivePage({
  searchParams,
}: {
  searchParams: { property?: string };
}) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const [locale, tStage4, tStages, tCommon] = await Promise.all([
    getLocale(),
    getTranslations("stage4"),
    getTranslations("stages"),
    getTranslations("common"),
  ]);

  // Optional per-property context. Verify org ownership BEFORE reading the
  // summary so a raw ?property id can't surface another org's leads.
  let summary: AfterLiveSummary | null = null;
  const propertyId = searchParams.property?.trim();
  if (propertyId) {
    const supabase = createClient();
    const { data: owned } = await supabase
      .from("properties")
      .select("id")
      .eq("id", propertyId)
      .eq("organization_id", org.id)
      .maybeSingle();
    if (owned?.id) {
      summary = await propertyAfterLiveSummary(owned.id);
    }
  }

  return (
    <StageShell
      as="section"
      eyebrow={tStages("s4")}
      title={tStage4("title")}
      subtitle={tStage4("sub")}
      action={
        <LanguageDropdown
          locale={assertSupportedLocale(locale)}
          action={setLocaleFromFormData}
          label={tCommon("language")}
          submitLabel={tCommon("apply")}
          pinned
          size="lg"
        />
      }
      className="min-h-[calc(100vh-14rem)] pb-28 pt-0"
    >
      <Card className="space-y-3" padded>
        <h2 className="text-[length:var(--vl-type-h2)] font-semibold leading-tight text-[var(--vl-text-primary)]">
          {tStage4("leadsTitle")}
        </h2>
        <p className="text-[length:var(--vl-type-guided-body)] leading-relaxed text-[var(--vl-text-secondary)]">
          {tStage4("leadsBody")}
        </p>
        {summary && summary.leads.length > 0 && (
          <ul className="space-y-2">
            {summary.leads.map((lead) => (
              <li
                key={lead.id}
                className="flex items-start justify-between gap-3 border-b border-[var(--vl-border)] pb-2 last:border-0"
              >
                <span className="font-medium text-[var(--vl-text-primary)]">
                  {lead.name ?? "—"}
                </span>
                <span className="text-right text-[var(--vl-text-secondary)]">
                  {lead.channel ?? "—"}
                  {lead.receivedOn ? ` · ${lead.receivedOn.slice(0, 10)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-3" padded>
        <h2 className="text-[length:var(--vl-type-h2)] font-semibold leading-tight text-[var(--vl-text-primary)]">
          {tStage4("takedownTitle")}
        </h2>
        <p className="text-[length:var(--vl-type-guided-body)] leading-relaxed text-[var(--vl-text-secondary)]">
          {tStage4("takedownBody")}
        </p>
        {summary && summary.channels.length > 0 && (
          <ul className="space-y-2">
            {summary.channels.map((ch, index) => (
              <li
                key={`${ch.channel}-${index}`}
                className="flex items-center justify-between gap-3 border-b border-[var(--vl-border)] pb-2 last:border-0"
              >
                <span className="font-medium text-[var(--vl-text-primary)]">
                  {channelByKey(ch.channel)?.label ?? ch.channel}
                </span>
                <StatusChip tone={ch.takenDown ? "neutral" : "success"}>
                  {tStage4(stage4BadgeKey(ch.takenDown))}
                </StatusChip>
              </li>
            ))}
          </ul>
        )}
        {summary?.leasedUp ? (
          <StatusBanner tone="success" title={tStage4("leasedDone")} />
        ) : (
          <Button size="lg" disabled>
            {tStage4("markLeased")}
          </Button>
        )}
      </Card>

      <BackNext
        backHref="/dashboard/send-live"
        nextHref="/dashboard"
        backLabel={tCommon("back")}
        nextLabel={tCommon("next")}
        ariaLabel={tCommon("stepNavigation")}
      />
    </StageShell>
  );
}
