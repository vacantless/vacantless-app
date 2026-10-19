import Link from "next/link";
import { countViewingTimes } from "@/lib/viewing-times-count";
import { notFound } from "next/navigation";
import { Icons } from "@/components/icons";
import { PageHeader, SECONDARY_ACTION_CLASS } from "@/components/ui";
import { canUseListingAiImport } from "@/lib/billing";
import { envFlagEnabled } from "@/lib/auto-listing-copy";
import { getCurrentOrg } from "@/lib/org";
import { isHiddenForOrg, MARKETPLACE_CHANNEL_KEY, RENTALS_CA_CHANNEL_KEY } from "@/lib/posting-lanes";
import { createClient } from "@/lib/supabase/server";
import { AddPropertyV2Form } from "./add-property-form";

export const dynamic = "force-dynamic";

export default async function NewPropertyPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  if (!envFlagEnabled(process.env.ADD_PROPERTY_V2_ENABLED)) {
    notFound();
  }

  const org = await getCurrentOrg();
  if (!org) return null;

  const supabase = createClient();
  // S710: weekly windows OR dated hours still to come (lib/viewing-times-count).
  const availabilityCount = await countViewingTimes(supabase, org.id, org.booking_timezone || undefined);

  // S724 (V251-02): "Listed by" starts from the org's own setting.
  const { data: orgListing } = await supabase
    .from("organizations")
    .select("for_rent_by")
    .eq("id", org.id)
    .maybeSingle();
  const defaultForRentBy =
    (orgListing as { for_rent_by?: string | null } | null)?.for_rent_by === "professional"
      ? "professional"
      : "owner";

  const aiImageImportEnabled =
    !!process.env.LISTING_AI_IMPORT_ENABLED && canUseListingAiImport(org.plan);

  return (
    <div>
      <PageHeader
        icon={<Icons.building />}
        eyebrow="Rentals"
        title="Add rental"
        subtitle="Fill in the basics. Renters can't see it until you make it public."
        action={
          <Link href="/dashboard/properties" className={SECONDARY_ACTION_CLASS}>
            Back to rentals
          </Link>
        }
      />

      {searchParams.error === "address" && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Add an address before saving this rental.
        </p>
      )}

      <AddPropertyV2Form
        availabilityWindowCount={availabilityCount ?? 0}
        replyToEmail={org.reply_to_email}
        contactPhone={org.public_contact_phone}
        aiImageImportEnabled={aiImageImportEnabled}
        defaultForRentBy={defaultForRentBy}
        policyDefaults={{
          lease_term: org.policy_lease_term ?? null,
          smoking: org.policy_smoking ?? null,
          ac_type: org.policy_ac_type ?? null,
        }}
        hiddenReadinessChannels={[
          // The readiness panel names Marketplace "facebook_marketplace".
          ...(isHiddenForOrg(MARKETPLACE_CHANNEL_KEY, org.id) ? ["facebook_marketplace"] : []),
          ...(isHiddenForOrg(RENTALS_CA_CHANNEL_KEY, org.id) ? ["rentals_ca"] : []),
        ]}
      />
    </div>
  );
}
