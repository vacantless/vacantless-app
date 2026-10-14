// S717: staff-only per-account switches (migration 0247). A switch is on when
// the account is in the built-in list below (Agile today) OR staff turned it
// on in /dashboard/admin. Landlords can never write these: the table is
// service-role only. organization_feature_flags is NOT used because any org
// member can write their own rows there.
//
// Reads never throw. If the table is missing (migration not applied yet) or
// unreadable, only the built-in list counts, which is today's behaviour.

export const PLATFORM_SWITCHES = {
  shared_sms_number: {
    label: "Texts from the shared number",
    description:
      "Renter and tenant texts go out from the one Vacantless QUO number, and replies to it are filed to this account. Only for accounts the number's registration covers.",
    builtIn: ["921f7c08-98af-428f-a238-36f4a781b0de"], // Agile Real Estate Group
  },
  answers_own_enquiries: {
    label: "Answers its own emailed-in renters",
    description:
      "Emailed-in renters are filed with no instant reply, because the landlord's own staff answer every renter.",
    builtIn: ["921f7c08-98af-428f-a238-36f4a781b0de"], // Agile: Aaliyah answers every renter (Noam, 2026-10-08)
  },
} as const;

export type PlatformSwitchKey = keyof typeof PLATFORM_SWITCHES;
export const PLATFORM_SWITCH_KEYS = Object.keys(PLATFORM_SWITCHES) as PlatformSwitchKey[];

export function isPlatformSwitchKey(v: string): v is PlatformSwitchKey {
  return (PLATFORM_SWITCH_KEYS as string[]).includes(v);
}

/** Built-in only (no database). Pure. */
export function builtInSwitchOn(key: PlatformSwitchKey, orgId: string | null | undefined): boolean {
  return !!orgId && (PLATFORM_SWITCHES[key].builtIn as readonly string[]).includes(orgId);
}

type FromClient = { from: (table: string) => any };

/** Which of these orgs have the switch on (built-in or staff row). Never throws. */
export async function orgsWithSwitch(
  admin: FromClient | null | undefined,
  key: PlatformSwitchKey,
  orgIds: readonly (string | null | undefined)[],
): Promise<Set<string>> {
  const ids = [...new Set(orgIds.filter((x): x is string => !!x))];
  const on = new Set(ids.filter((id) => builtInSwitchOn(key, id)));
  const rest = ids.filter((id) => !on.has(id));
  if (!admin || rest.length === 0) return on;
  try {
    const { data, error } = await admin
      .from("platform_org_switches")
      .select("organization_id, enabled")
      .eq("switch_key", key)
      .in("organization_id", rest);
    if (error || !Array.isArray(data)) return on;
    for (const r of data as { organization_id: string; enabled: boolean }[]) {
      if (r.enabled === true) on.add(r.organization_id);
    }
  } catch {
    // table missing or unreadable: built-in only
  }
  return on;
}

export async function orgHasSwitch(
  admin: FromClient | null | undefined,
  key: PlatformSwitchKey,
  orgId: string | null | undefined,
): Promise<boolean> {
  if (!orgId) return false;
  return (await orgsWithSwitch(admin, key, [orgId])).has(orgId);
}
