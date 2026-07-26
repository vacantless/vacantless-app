import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { setLocaleFromFormData } from "@/app/i18n/actions";
import {
  BackNext,
  ButtonLink,
  Card,
  LanguageDropdown,
  StageShell,
  StatusBanner,
} from "@/components/ui";
import { channelByKey } from "@/lib/distribution-channels";
import { getCurrentOrg } from "@/lib/org";
import {
  canRenderStage1Connect,
  groupStage1ChannelRows,
  stage1ConnectButtonKey,
  stage1ConnectHref,
  stage1StatusCopy,
  STAGE1_CONNECT_KIND_COPY,
} from "@/lib/stage1-link-portals";
import { assertSupportedLocale } from "@/lib/i18n/locale";
import { listChannelTileStatuses } from "../properties/actions";

export const dynamic = "force-dynamic";

export default async function LinkPortalsPage() {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const [rows, locale, tStage1, tStages, tCommon] = await Promise.all([
    listChannelTileStatuses(org.id),
    getLocale(),
    getTranslations("stage1"),
    getTranslations("stages"),
    getTranslations("common"),
  ]);
  const groups = groupStage1ChannelRows(rows);

  return (
    <StageShell
      as="section"
      eyebrow={tStages("s1")}
      title={tStage1("title")}
      subtitle={tStage1("sub")}
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
      {groups.map((group) => {
        if (group.rows.length === 0) return null;

        return (
          <section key={group.id} className="space-y-3">
            <h2 className="text-[length:var(--vl-type-h2)] font-semibold leading-tight text-[var(--vl-text-primary)]">
              {tStage1(group.titleKey)}
            </h2>
            <div className="space-y-4">
              {group.rows.map((row) => {
                const channel = channelByKey(row.channel);
                if (!channel) return null;

                const copy = stage1StatusCopy(row.state);
                const connectKindKey =
                  STAGE1_CONNECT_KIND_COPY[channel.connectKind];
                const showConnect = canRenderStage1Connect(
                  row,
                  channel.connectKind,
                );
                const connectHref = stage1ConnectHref(
                  row.channel,
                  channel.connectKind,
                );
                const buttonKey = stage1ConnectButtonKey(channel.connectKind);

                return (
                  <Card key={row.channel} className="space-y-4" padded>
                    <div className="space-y-3">
                      <h3 className="text-xl font-bold leading-tight text-[var(--vl-text-primary)]">
                        {channel.label}
                      </h3>
                      <StatusBanner tone={copy.tone} title={tStage1(copy.titleKey)}>
                        {tStage1(copy.subKey)}
                      </StatusBanner>
                    </div>

                    <p className="text-[length:var(--vl-type-guided-body)] leading-relaxed text-[var(--vl-text-secondary)]">
                      {tStage1(connectKindKey)}
                    </p>

                    <div className="space-y-3">
                      {showConnect && connectHref && buttonKey && (
                        <ButtonLink href={connectHref} size="lg">
                          {tStage1(buttonKey, { name: channel.label })}
                        </ButtonLink>
                      )}
                      {channel.key === "instagram" && (
                        <p className="text-base leading-relaxed text-[var(--vl-text-muted)]">
                          {tStage1("igNote")}
                        </p>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}

      <BackNext
        backHref="/dashboard"
        nextHref="/dashboard/add-details"
        backLabel={tCommon("back")}
        nextLabel={tCommon("next")}
        ariaLabel={tCommon("stepNavigation")}
      />
    </StageShell>
  );
}
