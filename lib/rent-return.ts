// ============================================================================
// rent-return (S834a). A landlord who starts Stripe setup from a tenancy comes
// back to that tenancy after Stripe's form, to send the tenant the bank link.
// Only an internal tenancy path is accepted, so the value can never send
// anyone to another site.
// ============================================================================

const TENANCY_PATH = /^\/dashboard\/tenancies\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function safeTenancyBack(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return TENANCY_PATH.test(t) ? t : null;
}

/** The query piece to add to a Settings URL: "" or "&back=<encoded path>". */
export function backQuery(v: unknown): string {
  const back = safeTenancyBack(v);
  return back ? `&back=${encodeURIComponent(back)}` : "";
}
