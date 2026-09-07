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
import { distributionWizardEnabled, withPropertyParam } from "@/lib/stage-wizard-nav";
import { getCurrentRole } from "@/lib/membership";
import { roleCan } from "@/lib/roles";
import { loadQuestionSheet } from "@/lib/question-sheet-load";
import { QUESTION_KEYS, type QuestionKey, type QuestionSheet } from "@/lib/question-sheet";
import { portalRequirementsFor } from "@/lib/portal-requirements";
import { QuestionSheetForm, type QuestionSheetCopy } from "./question-sheet-form";
import {
  STAGE2_METHODS,
  stage2FieldStatusKey,
  toStage2Preview,
} from "@/lib/stage2-add-details";

export const dynamic = "force-dynamic";

// Stage 2 "Add property details" (S584). Guided density on the S583a kit. The
// three cards route to the existing intake rails; the read panel shows the
// honest empty state until a real intake result is threaded in.
//
// S692 (SPEC-S688 Slice 2 sections 4.2 + 4.4): with the wizard flag on, an
// owned `?property=` and migration 0226 applied, this page renders the
// question sheet instead of the three cards. Pre-0226 the loader answers
// "column_missing" and the cards stay, so this ships dark.
export default async function AddDetailsPage({
  searchParams,
}: {
  searchParams: { property?: string };
}) {
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

  // Optional per-listing context. Validate org ownership before trusting the
  // id; the document/manual intake cards then deep-link to that property.
  let ownedPropertyId: string | null = null;
  let propertyAddress: string | null = null;
  const requestedProperty = searchParams.property?.trim();
  if (requestedProperty) {
    const { data: owned } = await supabase
      .from("properties")
      .select("id, address")
      .eq("id", requestedProperty)
      .eq("organization_id", org.id)
      .maybeSingle();
    if (owned?.id) {
      ownedPropertyId = owned.id as string;
      propertyAddress = (owned.address as string | null) ?? null;
    }
  }

  const [locale, tStage2, tStages, tCommon] = await Promise.all([
    getLocale(),
    getTranslations("stage2"),
    getTranslations("stages"),
    getTranslations("common"),
  ]);

  // The question sheet (S692). Only for an owned property, only with the
  // wizard on, only once 0226 exists; every other case falls through to the
  // three cards exactly as before.
  let sheet: QuestionSheet | null = null;
  if (ownedPropertyId && distributionWizardEnabled()) {
    const role = await getCurrentRole();
    const loaded = await loadQuestionSheet(supabase, {
      propertyId: ownedPropertyId,
      org,
      callerCanEditOrg: roleCan(role, "manage_settings"),
    });
    if (loaded.available) sheet = loaded.sheet;
  }
  const sheetCopy: QuestionSheetCopy | null = sheet
    ? {
        title: tStage2("sheet.title"),
        sub: tStage2("sheet.sub"),
        requiredTitle: tStage2("sheet.requiredTitle"),
        requiredSub: tStage2("sheet.requiredSub"),
        answerOnceTitle: tStage2("sheet.answerOnceTitle"),
        answerOnceSub: tStage2("sheet.answerOnceSub"),
        recommendedTitle: tStage2("sheet.recommendedTitle"),
        recommendedSub: tStage2("sheet.recommendedSub"),
        orgTitle: tStage2("sheet.orgTitle"),
        orgSub: tStage2("sheet.orgSub"),
        orgReadOnly: tStage2("sheet.orgReadOnly"),
        choose: tStage2("sheet.choose"),
        yes: tStage2("sheet.yes"),
        no: tStage2("sheet.no"),
        cats: tStage2("sheet.cats"),
        dogs: tStage2("sheet.dogs"),
        dogSize: tStage2("sheet.dogSize"),
        petsNotes: tStage2("sheet.petsNotes"),
        parkingType: tStage2("sheet.parkingType"),
        parkingCount: tStage2("sheet.parkingCount"),
        addPhotos: tStage2("sheet.addPhotos"),
        save: tStage2("sheet.save"),
        saving: tStage2("sheet.saving"),
        saved: tStage2("sheet.saved"),
        savedComplete: tStage2("sheet.savedComplete"),
        skippedOrg: tStage2("sheet.skippedOrg", { fields: "{fields}" }),
        fixErrors: tStage2("sheet.fixErrors"),
        mirrored: tStage2("sheet.mirrored"),
        neededBy: tStage2("sheet.neededBy", { sites: "{sites}" }),
        wouldPost: tStage2("sheet.wouldPost", { value: "{value}" }),
        photosLine: tStage2("sheet.photosLine", { current: "{current}", min: "{min}" }),
        labels: Object.fromEntries(
          QUESTION_KEYS.map((key) => [key, tStage2(`sheet.q.${key}`)]),
        ) as Record<QuestionKey, string>,
        siteLabels: Object.fromEntries(
          sheet.channels.map((channel) => [channel, portalRequirementsFor(channel)?.label ?? channel]),
        ),
      }
    : null;

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
      {propertyAddress && (
        <p className="text-[length:var(--vl-type-guided-body)] text-[var(--vl-text-secondary)]">
          {tCommon("forListing")}{" "}
          <span className="font-semibold text-[var(--vl-text-primary)]">
            {propertyAddress}
          </span>
        </p>
      )}
      {sheet && sheetCopy && ownedPropertyId ? (
        <>
          <Card className="space-y-2" padded>
            <h2 className="text-xl font-bold leading-tight text-[var(--vl-text-primary)]">
              {sheetCopy.title}
            </h2>
            <p className="text-[length:var(--vl-type-guided-body)] leading-relaxed text-[var(--vl-text-secondary)]">
              {sheetCopy.sub}
            </p>
            <p className="text-sm font-semibold text-[var(--vl-text-primary)]">
              {tStage2("sheet.requiredLeft", { count: sheet.requiredRemaining })}
              {sheet.answerOnceRemaining > 0
                ? ` · ${tStage2("sheet.answerOnceLeft", { count: sheet.answerOnceRemaining })}`
                : ""}
            </p>
          </Card>
          <QuestionSheetForm
            propertyId={ownedPropertyId}
            propertyPageHref={`/dashboard/properties/${ownedPropertyId}`}
            sheet={sheet}
            copy={sheetCopy}
            todayIso={new Date().toISOString().slice(0, 10)}
          />
        </>
      ) : (
      <div className="space-y-4">
        {STAGE2_METHODS.map((method) => {
          // Document + manual intake target THIS listing when one is in
          // context; email stays the org-level ingest address.
          const methodHref =
            ownedPropertyId &&
            (method.id === "document" || method.id === "manual")
              ? `/dashboard/properties/${ownedPropertyId}`
              : method.href;
          return (
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
              <ButtonLink href={methodHref} size="lg">
                {tStage2(method.titleKey)}
              </ButtonLink>
            </Card>
          );
        })}
      </div>
      )}

      {sheet ? null : (
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
      )}

      <BackNext
        backHref={withPropertyParam("/dashboard/link-portals", ownedPropertyId)}
        nextHref={withPropertyParam("/dashboard/send-live", ownedPropertyId)}
        backLabel={tCommon("back")}
        nextLabel={tCommon("next")}
        ariaLabel={tCommon("stepNavigation")}
        nextDisabled={sheet != null && sheet.requiredRemaining > 0}
        nextHint={sheet != null && sheet.requiredRemaining > 0 ? tStage2("sheet.nextBlocked") : undefined}
      />
    </StageShell>
  );
}
