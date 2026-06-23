import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import {
  BrandBanner,
  Card,
  SectionHeading,
  EmptyState,
  SECONDARY_ACTION_CLASS,
} from "@/components/ui";
import { Icons } from "@/components/icons";
import BuildingNoticeComposer from "@/components/building-notice-composer";
import {
  buildBuildingOptions,
  planBuildingEmailDeliveries,
  tallyBuildingDeliveries,
  buildingNoticeErrorMessage,
  composeNoticeFromWorkOrder,
  type BuildingTenancy,
} from "@/lib/building-notices";
import type { TenantContact } from "@/lib/tenant-comms";
import { sendBuildingNotice } from "./actions";

// Building notices (S321) — the OUTBOUND, building-wide counterpart to per-tenancy
// tenant messaging. An operator drafts one notice and it emails every tenant on
// every tenancy in a chosen building (the scheduled-building-work case). Lives
// under the Maintenance area because that's where the demand originates, but it
// targets a building, not a work order. Guardrail-neutral: operator -> tenant,
// email only, no trade, no money, never auto-send.

export const dynamic = "force-dynamic";

type SearchParams = {
  building?: string;
  from_wo?: string;
  msg?: string;
  s?: string;
  k?: string;
  f?: string;
};

const SUCCESS_CODES = new Set(["sent"]);

function successFlash(sp: SearchParams): string | null {
  if (sp.msg !== "sent") return null;
  const s = sp.s ?? "0";
  const k = sp.k ?? "0";
  const extra = Number(k) > 0 ? ` ${k} skipped (no email on file).` : "";
  return `Notice sent to ${s} ${Number(s) === 1 ? "tenant" : "tenants"}.${extra}`;
}

function errorFlash(sp: SearchParams): string | null {
  if (!sp.msg || SUCCESS_CODES.has(sp.msg)) return null;
  if (sp.msg === "failed")
    return "The notice could not be sent. Please try again, or check your email settings.";
  return buildingNoticeErrorMessage(sp.msg);
}

export default async function BuildingNoticesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const org = await getCurrentOrg();
  const supabase = createClient();

  const { data: propData } = await supabase
    .from("properties")
    .select("id, address, building_key");
  const buildingOptions = buildBuildingOptions(
    (propData ?? []) as { id: string; address: string; building_key: string | null }[],
  );

  // Notice-from-work-order (plan §10 pt 3): ?from_wo=<id> drops the operator into
  // the composer pre-filled from a scheduled work order. We resolve the work
  // order (RLS-scoped to the org), derive its building (its own building_key, or
  // its unit's), and build an editable draft. An explicit ?building= still wins.
  const fromWoId = (searchParams.from_wo ?? "").trim() || null;
  let prefillSubject = "";
  let prefillBody = "";
  let prefillImpact = "";
  let prefillNote: string | null = null;
  let woBuildingKey: string | null = null;

  if (fromWoId) {
    const { data: wo } = await supabase
      .from("work_orders")
      .select(
        "id, title, description, category, building_key, scheduled_for, expected_start, expected_finish, property:properties(building_key), trade:trade_contacts(name)",
      )
      .eq("id", fromWoId)
      .maybeSingle();
    if (wo) {
      const w = wo as unknown as {
        title: string | null;
        description: string | null;
        category: string | null;
        building_key: string | null;
        scheduled_for: string | null;
        expected_start: string | null;
        expected_finish: string | null;
        property: { building_key: string | null } | null;
        trade: { name: string | null } | null;
      };
      woBuildingKey = w.building_key ?? w.property?.building_key ?? null;
      const draft = composeNoticeFromWorkOrder({
        title: w.title,
        description: w.description,
        category: w.category,
        tradeName: w.trade?.name ?? null,
        scheduledFor: w.scheduled_for,
        expectedStart: w.expected_start,
        expectedFinish: w.expected_finish,
      });
      prefillSubject = draft.subject;
      prefillBody = draft.body;
      prefillImpact = draft.impact;
      prefillNote = w.title
        ? `Pre-filled from the work order "${w.title}". Review the details, dates, and what-to-expect line before sending.`
        : "Pre-filled from a work order. Review the details, dates, and what-to-expect line before sending.";
    }
  }

  const selectedBuildingKey =
    ((searchParams.building ?? "").trim() || null) ?? woBuildingKey;

  let summary = null;
  let sampleAddress: string | null = null;
  if (selectedBuildingKey) {
    const { data: tenData } = await supabase
      .from("tenancies")
      .select(
        "id, rent_cents, property:properties!inner(address, building_key), tenants(id, name, email, phone, sms_opt_out)",
      )
      .eq("property.building_key", selectedBuildingKey);

    const tenancies: BuildingTenancy[] = ((tenData ?? []) as unknown as {
      id: string;
      rent_cents: number | null;
      property: { address: string; building_key: string | null } | null;
      tenants: TenantContact[];
    }[]).map((t) => ({
      tenancyId: t.id,
      propertyAddress: t.property?.address ?? null,
      rentCents: t.rent_cents ?? null,
      tenants: t.tenants ?? [],
    }));

    sampleAddress = tenancies.find((t) => t.propertyAddress)?.propertyAddress ?? null;
    summary = tallyBuildingDeliveries(planBuildingEmailDeliveries(tenancies));
  }

  // Recent sends (history).
  const { data: history } = await supabase
    .from("building_notices")
    .select(
      "id, building_label, building_key, subject, recipient_count, sent_count, skipped_count, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(10);

  const tz = org?.booking_timezone || "America/Toronto";
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-CA", {
      timeZone: tz,
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const flash = successFlash(searchParams);
  const error = errorFlash(searchParams);

  return (
    <div>
      <BrandBanner
        eyebrow="Maintenance"
        title="Building notices"
        subtitle="Send one notice by email to every tenant in a building - the right tool for scheduled work, like an electrical shutdown or water shut-off. You always draft and review before it sends. Nothing here dispatches a trade or moves money."
        icon={<Icons.bolt className="h-6 w-6" />}
        action={
          <Link href="/dashboard/maintenance" className={SECONDARY_ACTION_CLASS}>
            ← Back to maintenance
          </Link>
        }
      />

      {flash && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {flash}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Card>
            <SectionHeading>Draft a notice</SectionHeading>
            {buildingOptions.length === 0 ? (
              <EmptyState
                title="No buildings yet"
                description="Add rental units with a shared building address to send a building-wide notice."
              />
            ) : (
              <div className="mt-3">
                <BuildingNoticeComposer
                  buildingOptions={buildingOptions}
                  selectedBuildingKey={selectedBuildingKey}
                  summary={summary}
                  sampleAddress={sampleAddress}
                  orgName={org?.name ?? null}
                  orgContactEmail={org?.public_contact_email ?? null}
                  orgContactPhone={org?.public_contact_phone ?? null}
                  initialSubject={prefillSubject}
                  initialBody={prefillBody}
                  initialImpact={prefillImpact}
                  prefillNote={prefillNote}
                  sendAction={sendBuildingNotice}
                />
              </div>
            )}
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <SectionHeading>Recent notices</SectionHeading>
            {(history ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">
                Notices you send will be listed here.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-gray-100">
                {(history ?? []).map((h) => (
                  <li key={h.id} className="py-3 text-sm">
                    <p className="font-medium text-gray-900">{h.subject}</p>
                    <p className="text-xs text-gray-500">
                      {h.building_label || h.building_key} · {fmtDate(h.created_at)}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      Sent to {h.sent_count} of {h.recipient_count}
                      {h.skipped_count > 0 ? ` · ${h.skipped_count} skipped` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
