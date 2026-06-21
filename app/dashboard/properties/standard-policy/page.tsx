import Link from "next/link";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import {
  updatePolicyProfile,
  updateBuildingPolicy,
} from "@/app/dashboard/settings/actions";
import {
  LEASE_TERM_OPTIONS,
  leaseTermLabel,
  SMOKING_OPTIONS,
  smokingLabel,
  AC_TYPE_OPTIONS,
  acTypeLabel,
  DOG_SIZE_OPTIONS,
  dogSizeLabel,
} from "@/lib/property-features";
import { splitAddressUnit } from "@/lib/listing-fill-sheet";
import { BrandBanner, IconTile } from "@/components/ui";
import { Icons } from "@/components/icons";

export const dynamic = "force-dynamic";

// ============================================================================
// Building standard policy — IA Step 3 (S275) relocated this here; slice 2
// (S276, migration 0049) added the PER-BUILDING override below the org default.
//
// TWO levels, resolved unit > building > org:
//   • Organization defaults (0048) — the org-wide baseline every unit inherits.
//   • Per-building overrides (0049) — when a building's policy differs from the
//     org (Agile spans Mercer / Manning / Pillette, each with its own A/C etc.),
//     set it ONCE for that building; every unit in it inherits the building
//     value unless the unit's own page overrides it.
//
// A "building" = the units that share a normalized street address
// (properties.building_key, a generated column). Slice 2b (S277, migration 0050)
// extended inheritance to included utilities (heat/hydro/water) + the pet policy
// (cats/dogs/dog-size); they now appear at BOTH the org and per-building levels
// and resolve unit > building > org like the four original fields.
// ============================================================================

// A/C "Inherit" hint label — handles the "none" sentinel + the unset case.
function acInheritLabel(value: string | null | undefined): string {
  if (value === "none") return "no A/C";
  const label = acTypeLabel(value);
  return label ? label : "not set";
}

function onSiteInheritLabel(value: boolean | null | undefined): string {
  return value == null ? "not set" : value ? "yes" : "no";
}

// Utilities/pets standard-policy fields (0050). These share one render helper
// across the org-defaults form and each per-building form. `base` is null on the
// org form (empty option reads "Not set") and the resolved org values on a
// building form (empty option reads "Inherit (<org value>)").
type FeaturePolicy = {
  policy_heat_included: boolean | null;
  policy_hydro_included: boolean | null;
  policy_water_included: boolean | null;
  policy_pets_cats: boolean | null;
  policy_pets_dogs: boolean | null;
  policy_pets_dog_size: string | null;
};

function boolToSelect(v: boolean | null | undefined): string {
  return v == null ? "" : v ? "true" : "false";
}
function utilInheritWord(v: boolean | null | undefined): string {
  return v == null ? "not set" : v ? "included" : "tenant pays";
}
function petInheritWord(v: boolean | null | undefined): string {
  return v == null ? "not set" : v ? "welcome" : "not welcome";
}

function FeatureTriSelect({
  name,
  value,
  base,
  trueLabel,
  falseLabel,
  emptyWord,
}: {
  name: string;
  value: boolean | null;
  base: boolean | null | undefined;
  trueLabel: string;
  falseLabel: string;
  emptyWord: (v: boolean | null | undefined) => string;
}) {
  const isBuilding = base !== undefined;
  return (
    <select name={name} defaultValue={boolToSelect(value)} className={SELECT_CLASS}>
      <option value="">
        {isBuilding ? `Inherit (${emptyWord(base)})` : "Not set"}
      </option>
      <option value="true">{trueLabel}</option>
      <option value="false">{falseLabel}</option>
    </select>
  );
}

function FeaturePolicyFields({
  values,
  base,
}: {
  values: FeaturePolicy;
  base: FeaturePolicy | null;
}) {
  const isBuilding = base !== null;
  return (
    <div className="mt-5 border-t border-gray-100 pt-5">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
        Utilities included in rent
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {(
          [
            ["policy_heat_included", "Heat", "heat"],
            ["policy_hydro_included", "Hydro", "hydro"],
            ["policy_water_included", "Water", "water"],
          ] as const
        ).map(([name, label, k]) => (
          <label key={name} className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              {label}
            </span>
            <FeatureTriSelect
              name={name}
              value={values[name]}
              base={isBuilding ? base![name] : undefined}
              trueLabel="Included"
              falseLabel="Tenant pays"
              emptyWord={utilInheritWord}
            />
          </label>
        ))}
      </div>

      <p className="mb-3 mt-5 text-xs font-semibold uppercase tracking-wider text-gray-400">
        Pet policy
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Cats</span>
          <FeatureTriSelect
            name="policy_pets_cats"
            value={values.policy_pets_cats}
            base={isBuilding ? base!.policy_pets_cats : undefined}
            trueLabel="Welcome"
            falseLabel="Not welcome"
            emptyWord={petInheritWord}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Dogs</span>
          <FeatureTriSelect
            name="policy_pets_dogs"
            value={values.policy_pets_dogs}
            base={isBuilding ? base!.policy_pets_dogs : undefined}
            trueLabel="Welcome"
            falseLabel="Not welcome"
            emptyWord={petInheritWord}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            Dog size limit
          </span>
          <select
            name="policy_pets_dog_size"
            defaultValue={values.policy_pets_dog_size ?? ""}
            className={SELECT_CLASS}
          >
            <option value="">
              {isBuilding
                ? `Inherit (${dogSizeLabel(base!.policy_pets_dog_size) ?? "no limit"})`
                : "Not set"}
            </option>
            {DOG_SIZE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {dogSizeLabel(opt)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-3 text-xs text-gray-400">
        Applies to dogs when they&apos;re welcome. In Ontario a &ldquo;no
        pets&rdquo; lease clause is void (RTA s.14) — this is a listing/screening
        preference, not an enforceable rule.
      </p>
    </div>
  );
}

type BuildingOverride = {
  policy_lease_term: string | null;
  policy_smoking: string | null;
  policy_ac_type: string | null;
  policy_on_site_management: boolean | null;
} & FeaturePolicy;

type BuildingRow = {
  key: string;
  label: string;
  units: number;
  override: BuildingOverride | null;
};

const SELECT_CLASS =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

export default async function StandardPolicyPage({
  searchParams,
}: {
  searchParams: { policy?: string };
}) {
  const org = await getCurrentOrg();
  if (!org) return null;

  // --- Per-building data (0049) ---------------------------------------------
  // Distinct buildings the org actually has units in (keyed on building_key),
  // plus any existing override rows, so each building's form pre-fills.
  const supabase = createClient();
  const [{ data: propRows }, { data: overrideRows }] = await Promise.all([
    supabase
      .from("properties")
      .select("building_key, address")
      .eq("organization_id", org.id)
      .not("building_key", "is", null),
    supabase
      .from("org_building_policies")
      .select(
        "building_key, policy_lease_term, policy_smoking, policy_ac_type, policy_on_site_management, policy_heat_included, policy_hydro_included, policy_water_included, policy_pets_cats, policy_pets_dogs, policy_pets_dog_size",
      )
      .eq("organization_id", org.id),
  ]);

  const overrideByKey = new Map<string, BuildingOverride>();
  for (const r of overrideRows ?? []) {
    overrideByKey.set(r.building_key, {
      policy_lease_term: r.policy_lease_term,
      policy_smoking: r.policy_smoking,
      policy_ac_type: r.policy_ac_type,
      policy_on_site_management: r.policy_on_site_management,
      policy_heat_included: r.policy_heat_included,
      policy_hydro_included: r.policy_hydro_included,
      policy_water_included: r.policy_water_included,
      policy_pets_cats: r.policy_pets_cats,
      policy_pets_dogs: r.policy_pets_dogs,
      policy_pets_dog_size: r.policy_pets_dog_size,
    });
  }

  // The org-level utilities/pets defaults, in the shared FeaturePolicy shape
  // (used both to render the org form and as the "Inherit (...)" base for each
  // building form).
  const orgFeatureDefaults: FeaturePolicy = {
    policy_heat_included: org.policy_heat_included,
    policy_hydro_included: org.policy_hydro_included,
    policy_water_included: org.policy_water_included,
    policy_pets_cats: org.policy_pets_cats,
    policy_pets_dogs: org.policy_pets_dogs,
    policy_pets_dog_size: org.policy_pets_dog_size,
  };

  // Group units into buildings; keep the first address seen as the display
  // label (street portion, unit stripped). Sort by label.
  const buildingMap = new Map<string, { sample: string; units: number }>();
  for (const r of propRows ?? []) {
    const key = r.building_key as string;
    const existing = buildingMap.get(key);
    if (existing) {
      existing.units += 1;
    } else {
      buildingMap.set(key, { sample: r.address ?? key, units: 1 });
    }
  }
  const buildings: BuildingRow[] = [...buildingMap.entries()]
    .map(([key, { sample, units }]) => ({
      key,
      label: splitAddressUnit(sample).street ?? sample,
      units,
      override: overrideByKey.get(key) ?? null,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div>
      <BrandBanner
        eyebrow="Rentals"
        title="Building standard policy"
        subtitle="Set your standard policy once. Every unit inherits it on its listings, copy, and syndication feed — so you only re-enter a value where a building or unit genuinely differs."
        icon={<Icons.building className="h-6 w-6" />}
      />

      <p className="mt-4 text-sm text-gray-500">
        <Link href="/dashboard/properties" className="font-medium text-brand underline">
          ← Back to Rentals
        </Link>
      </p>

      {searchParams.policy === "saved" && (
        <div className="mt-4 max-w-2xl rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
          Standard policy saved.
        </div>
      )}
      {searchParams.policy === "error" && (
        <div className="mt-4 max-w-2xl rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          Something went wrong saving these settings. Please try again.
        </div>
      )}

      <div className="mt-6 max-w-2xl space-y-6">
        {/* --- 1. Organization defaults (0048) --- */}
        <form
          action={updatePolicyProfile}
          className="rounded-2xl border border-gray-200 bg-white p-5"
        >
          <div className="flex items-center gap-2.5">
            <IconTile size="sm"><Icons.page className="h-4 w-4" /></IconTile>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
              Organization defaults
            </h3>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Your portfolio-wide baseline. Every unit inherits these unless a
            building (below) or the unit&apos;s own page overrides them.
          </p>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                Standard lease term
              </span>
              <select
                name="policy_lease_term"
                defaultValue={org.policy_lease_term ?? "1_year"}
                className={SELECT_CLASS}
              >
                {LEASE_TERM_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {leaseTermLabel(opt)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                Air conditioning
              </span>
              <select
                name="policy_ac_type"
                defaultValue={org.policy_ac_type ?? ""}
                className={SELECT_CLASS}
              >
                <option value="">Not set</option>
                {AC_TYPE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt === "none"
                      ? "No air conditioning"
                      : `A/C: ${acTypeLabel(opt)}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                Smoking
              </span>
              <select
                name="policy_smoking"
                defaultValue={org.policy_smoking ?? ""}
                className={SELECT_CLASS}
              >
                <option value="">Not set</option>
                {SMOKING_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {smokingLabel(opt)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                On-site management
              </span>
              <select
                name="policy_on_site_management"
                defaultValue={
                  org.policy_on_site_management == null
                    ? ""
                    : org.policy_on_site_management
                      ? "true"
                      : "false"
                }
                className={SELECT_CLASS}
              >
                <option value="">Not set</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
          </div>

          <FeaturePolicyFields values={orgFeatureDefaults} base={null} />

          <button className="mt-5 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white shadow-sm">
            Save organization defaults
          </button>
        </form>

        {/* --- 2. Per-building overrides (0049) --- */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2.5">
            <IconTile size="sm"><Icons.building className="h-4 w-4" /></IconTile>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
              Per-building overrides
            </h3>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            When a building&apos;s policy differs from your defaults, set it once
            here. Every unit in that building inherits the building value (unless
            the unit&apos;s own page overrides it). Leave a field on
            &ldquo;Inherit&rdquo; to keep the organization default.
          </p>

          {buildings.length === 0 ? (
            <p className="mt-4 rounded-lg bg-gray-50 px-3 py-3 text-sm text-gray-500">
              No buildings yet. Add a rental with an address and it&apos;ll show
              up here, grouped by building.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {buildings.map((b) => {
                const ov = b.override;
                const hasOverride = ov != null;
                return (
                  <details
                    key={b.key}
                    className="group rounded-xl border border-gray-200 bg-gray-50/50"
                  >
                    <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm">
                      <span className="font-medium text-gray-800">
                        {b.label}
                        <span className="ml-2 font-normal text-gray-400">
                          {b.units} unit{b.units === 1 ? "" : "s"}
                        </span>
                      </span>
                      <span
                        className={
                          hasOverride
                            ? "rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand"
                            : "rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500"
                        }
                      >
                        {hasOverride ? "Custom policy" : "Inherits defaults"}
                      </span>
                    </summary>

                    <form
                      action={updateBuildingPolicy}
                      className="border-t border-gray-200 px-4 py-4"
                    >
                      <input type="hidden" name="building_key" value={b.key} />
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-sm font-medium text-gray-700">
                            Lease term
                          </span>
                          <select
                            name="policy_lease_term"
                            defaultValue={ov?.policy_lease_term ?? ""}
                            className={SELECT_CLASS}
                          >
                            <option value="">
                              Inherit ({leaseTermLabel(org.policy_lease_term) ?? "1-year lease"})
                            </option>
                            {LEASE_TERM_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {leaseTermLabel(opt)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-sm font-medium text-gray-700">
                            Air conditioning
                          </span>
                          <select
                            name="policy_ac_type"
                            defaultValue={ov?.policy_ac_type ?? ""}
                            className={SELECT_CLASS}
                          >
                            <option value="">
                              Inherit ({acInheritLabel(org.policy_ac_type)})
                            </option>
                            {AC_TYPE_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt === "none"
                                  ? "No air conditioning"
                                  : `A/C: ${acTypeLabel(opt)}`}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-sm font-medium text-gray-700">
                            Smoking
                          </span>
                          <select
                            name="policy_smoking"
                            defaultValue={ov?.policy_smoking ?? ""}
                            className={SELECT_CLASS}
                          >
                            <option value="">
                              Inherit ({smokingLabel(org.policy_smoking) ?? "not set"})
                            </option>
                            {SMOKING_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {smokingLabel(opt)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-sm font-medium text-gray-700">
                            On-site management
                          </span>
                          <select
                            name="policy_on_site_management"
                            defaultValue={
                              ov?.policy_on_site_management == null
                                ? ""
                                : ov.policy_on_site_management
                                  ? "true"
                                  : "false"
                            }
                            className={SELECT_CLASS}
                          >
                            <option value="">
                              Inherit ({onSiteInheritLabel(org.policy_on_site_management)})
                            </option>
                            <option value="true">Yes</option>
                            <option value="false">No</option>
                          </select>
                        </label>
                      </div>
                      <FeaturePolicyFields
                        values={
                          ov ?? {
                            policy_heat_included: null,
                            policy_hydro_included: null,
                            policy_water_included: null,
                            policy_pets_cats: null,
                            policy_pets_dogs: null,
                            policy_pets_dog_size: null,
                          }
                        }
                        base={orgFeatureDefaults}
                      />
                      <button className="mt-4 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white shadow-sm">
                        Save this building
                      </button>
                    </form>
                  </details>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
