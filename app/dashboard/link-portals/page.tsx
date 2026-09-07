import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { setLocaleFromFormData } from "@/app/i18n/actions";
import {
  BackNext,
  LanguageDropdown,
  StageShell,
} from "@/components/ui";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { assertSupportedLocale } from "@/lib/i18n/locale";
import { withPropertyParam } from "@/lib/stage-wizard-nav";
import { ConnectTiles } from "./connect-tiles";
import { buildLinkPortalsViewModel } from "./view-model";

export const dynamic = "force-dynamic";

export default async function LinkPortalsPage({
  searchParams,
}: {
  searchParams: { property?: string };
}) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  // Optional per-listing context. Validate org ownership before trusting the
  // id, then thread only the VALIDATED id through the wizard (Stages 1-4).
  let ownedPropertyId: string | null = null;
  let propertyAddress: string | null = null;
  const requestedProperty = searchParams.property?.trim();
  if (requestedProperty) {
    const supabase = createClient();
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

  const locale = await getLocale();
  const [vm, tStage1, tStages, tCommon] = await Promise.all([
    buildLinkPortalsViewModel(org.id, locale),
    getTranslations("stage1"),
    getTranslations("stages"),
    getTranslations("common"),
  ]);

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
      {propertyAddress && (
        <p className="text-[length:var(--vl-type-guided-body)] text-[var(--vl-text-secondary)]">
          {tCommon("forListing")}{" "}
          <span className="font-semibold text-[var(--vl-text-primary)]">
            {propertyAddress}
          </span>
        </p>
      )}

      <ConnectTiles initial={vm} />

      <BackNext
        backHref="/dashboard"
        nextHref={withPropertyParam("/dashboard/add-details", ownedPropertyId)}
        backLabel={tCommon("back")}
        nextLabel={tCommon("next")}
        ariaLabel={tCommon("stepNavigation")}
      />
    </StageShell>
  );
}
