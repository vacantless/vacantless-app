import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { setLocaleFromFormData } from "@/app/i18n/actions";
import {
  BackNext,
  Button,
  ButtonLink,
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
import {
  buildStage3SendRows,
  stage3AllLive,
  stage3SendableChannels,
} from "@/lib/stage3-send-live";
import { listChannelTileStatuses } from "../properties/actions";

export const dynamic = "force-dynamic";

// Stage 3 "Choose & send live" (S586). DARK: new route, not linked from any nav.
// Guided density on the S583a kit. Reads the EXISTING run-item state machine
// (distribution_run_items.publish_status) + distribution_verifications
// (verified_live) — NO new read-model. The oversized send button is PREVIEW
// ONLY here; the real one-click publish action lives in the property Distribute
// tab (wiring it in is part of un-dark). Each row's LIVE! comes from the item's
// OWN status corroborated by a real verified_live proof (rule 16), never a timer.
export default async function SendLivePage({
  searchParams,
}: {
  searchParams: { property?: string };
}) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const [rows, locale, tStage3, tStages, tCommon] = await Promise.all([
    listChannelTileStatuses(org.id),
    getLocale(),
    getTranslations("stage3"),
    getTranslations("stages"),
    getTranslations("common"),
  ]);

  const sendable = stage3SendableChannels(rows);

  // Optional per-property context: reflect a REAL active run's per-channel
  // publish_status + verified_live proofs. Verify org ownership BEFORE reading
  // any run data so a raw ?property id can't surface another org's run.
  const publishStatusByChannel = new Map<string, string | null>();
  const verifiedLiveChannels = new Set<string>();
  const propertyId = searchParams.property?.trim();
  if (propertyId && sendable.length > 0) {
    const supabase = createClient();
    const { data: owned } = await supabase
      .from("properties")
      .select("id")
      .eq("id", propertyId)
      .eq("organization_id", org.id)
      .maybeSingle();
    if (owned?.id) {
      const { data: run } = await supabase
        .from("distribution_runs")
        .select("id")
        .eq("property_id", owned.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const runId = (run?.id as string | undefined) ?? null;
      if (runId) {
        const { data: items } = await supabase
          .from("distribution_run_items")
          .select("channel, publish_status")
          .eq("run_id", runId);
        for (const item of items ?? []) {
          const channel = (item as { channel: string | null }).channel;
          if (channel) {
            publishStatusByChannel.set(
              channel,
              (item as { publish_status: string | null }).publish_status ?? null,
            );
          }
        }
        const { data: proofs } = await supabase
          .from("distribution_verifications")
          .select("channel, result")
          .eq("run_id", runId)
          .eq("result", "verified_live");
        for (const proof of proofs ?? []) {
          const channel = (proof as { channel: string | null }).channel;
          if (channel) verifiedLiveChannels.add(channel);
        }
      }
    }
  }

  const sendRows = buildStage3SendRows(
    sendable,
    publishStatusByChannel,
    verifiedLiveChannels,
  );
  const allLive = stage3AllLive(sendRows);

  return (
    <StageShell
      as="section"
      eyebrow={tStages("s3")}
      title={tStage3("title")}
      subtitle={tStage3("sub")}
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
      {sendable.length === 0 ? (
        <StatusBanner
          tone="attention"
          title={tStage3("onlyLinked")}
          action={
            <ButtonLink href="/dashboard/link-portals" size="lg">
              {tStages("s1")}
            </ButtonLink>
          }
        />
      ) : (
        <>
          <StatusBanner tone="info" title={tStage3("onlyLinked")} />

          <Card className="space-y-3" padded>
            <ul className="space-y-2">
              {sendRows.map((row) => {
                const channel = channelByKey(row.channel);
                if (!channel) return null;
                return (
                  <li
                    key={row.channel}
                    className="flex items-center justify-between gap-3 border-b border-[var(--vl-border)] pb-2 last:border-0"
                  >
                    <span className="font-medium text-[var(--vl-text-primary)]">
                      {channel.label}
                    </span>
                    <StatusChip tone={row.tone}>
                      {row.microKey === "posting"
                        ? tStage3("micro.posting", { name: channel.label })
                        : tStage3(`micro.${row.microKey}`)}
                    </StatusChip>
                  </li>
                );
              })}
            </ul>
          </Card>

          {allLive ? (
            <StatusBanner tone="success" title={tStage3("allDone")} />
          ) : (
            <Button size="lg" disabled>
              {tStage3("blast")}
            </Button>
          )}
        </>
      )}

      <BackNext
        backHref="/dashboard/add-details"
        nextHref="/dashboard/after-live"
        backLabel={tCommon("back")}
        nextLabel={tCommon("next")}
        ariaLabel={tCommon("stepNavigation")}
      />
    </StageShell>
  );
}
