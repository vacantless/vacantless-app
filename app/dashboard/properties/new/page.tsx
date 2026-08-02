import Link from "next/link";
import { notFound } from "next/navigation";
import { Icons } from "@/components/icons";
import { PageHeader, SECONDARY_ACTION_CLASS } from "@/components/ui";
import { canUseListingAiImport } from "@/lib/billing";
import { envFlagEnabled } from "@/lib/auto-listing-copy";
import { getCurrentOrg } from "@/lib/org";
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
  const { count: availabilityCount } = await supabase
    .from("availability_rules")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.id);

  const aiImageImportEnabled =
    !!process.env.LISTING_AI_IMPORT_ENABLED && canUseListingAiImport(org.plan);

  return (
    <div>
      <PageHeader
        icon={<Icons.building />}
        eyebrow="Portfolio"
        title="Add rental"
        subtitle="Import a listing first or start fresh, then save a private Draft."
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
      />
    </div>
  );
}
