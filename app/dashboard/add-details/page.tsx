import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { setLocaleFromFormData } from "@/app/i18n/actions";
import {
  BackNext,
  ButtonLink,
  Card,
  LanguageDropdown,
  StageShell,
  StatusChip,
} from "@/components/ui";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import {
  ingestAddressFromToken,
  DEFAULT_INGEST_DOMAIN,
} from "@/lib/email-ingest";
import { assertSupportedLocale } from "@/lib/i18n/locale";
import {
  STAGE2_METHODS,
  stage2FieldStatusKey,
  toStage2Preview,
} from "@/lib/stage2-add-details";

export const dynamic = "force-dynamic";

// Stage 2 "Add property details" (S584). DARK: new route, not linked from any
// nav. Guided density on the S583a kit. The three cards route to the existing
// intake rails; the read panel shows the honest empty state until a real
// intake result is threaded in (a later slice).
export default async function AddDetailsPage() {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();
  const { data: addr } = await supabase
    .from("org_ingest_addresses")
    .select("token")
    .eq("organization_id", org.id)
    .eq("channel", "email")
    .eq("active", true)
    .maybeSingle();
  const ingestDomain = process.env.INGEST_EMAIL_DOMAIN || DEFAULT_INGEST_DOMAIN;
  const ingestAddress = addr?.token
    ? ingestAddressFromToken(addr.token, ingestDomain)
    : null;

  const [locale, tStage2, tStages, tCommon] = await Promise.all([
    getLocale(),
    getTranslations("stage2"),
    getTranslations("stages"),
    getTranslations("common"),
  ]);

  // No intake threaded into this dark screen yet -> honest empty preview.
  const preview = toStage2Preview(null);

  return (
    <StageShell
      as="section"
      eyebrow={tStages("s2")}
      title={tStage2("title")}
      subtitle={tStage2("sub")}
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
      <div className="space-y-4">
        {STAGE2_METHODS.map((method) => (
          <Card key={method.id} className="space-y-3" padded>
            <h2 className="text-xl font-bold leading-tight text-[var(--vl-text-primary)]">
              {tStage2(method.titleKey)}
            </h2>
            <p className="text-[length:var(--vl-type-guided-body)] leading-relaxed text-[var(--vl-text-secondary)]">
              {tStage2(method.bodyKey)}
            </p>
            {method.id === "email" && ingestAddress && (
              <p className="break-all rounded-[var(--vl-radius-md)] border border-[var(--vl-border)] bg-[var(--vl-surface)] px-3 py-2 font-mono text-base text-[var(--vl-text-primary)]">
                {ingestAddress}
              </p>
            )}
            <ButtonLink href={method.href} size="lg">
              {tStage2(method.titleKey)}
            </ButtonLink>
          </Card>
        ))}
      </div>

      <Card className="space-y-3" padded>
        <h2 className="text-[length:var(--vl-type-h2)] font-semibold leading-tight text-[var(--vl-text-primary)]">
          {tStage2("readTitle")}
        </h2>
        {!preview.hasSource ? (
          <p className="text-[length:var(--vl-type-guided-body)] leading-relaxed text-[var(--vl-text-secondary)]">
            {tStage2("pickPrompt")}
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {preview.rows.map((row, index) => (
                <li
                  key={`${row.label}-${index}`}
                  className="flex items-start justify-between gap-3 border-b border-[var(--vl-border)] pb-2 last:border-0"
                >
                  <span className="text-[var(--vl-text-secondary)]">
                    {row.label}
                  </span>
                  <span className="flex items-center gap-2 text-right font-medium text-[var(--vl-text-primary)]">
                    {row.value}
                    <StatusChip tone={row.found ? "success" : "warn"}>
                      {tStage2(stage2FieldStatusKey(row.found))}
                    </StatusChip>
                  </span>
                </li>
              ))}
            </ul>
            {preview.publicDescription && (
              <div className="space-y-1 pt-2">
                <h3 className="text-base font-semibold text-[var(--vl-text-primary)]">
                  {tStage2("polishedTitle")}
                </h3>
                <p className="text-[length:var(--vl-type-guided-body)] leading-relaxed text-[var(--vl-text-secondary)]">
                  {preview.publicDescription}
                </p>
              </div>
            )}
          </>
        )}
      </Card>

      <BackNext
        backHref="/dashboard/link-portals"
        nextHref="/dashboard/send-live"
        backLabel={tCommon("back")}
        nextLabel={tCommon("next")}
        ariaLabel={tCommon("stepNavigation")}
      />
    </StageShell>
  );
}
