// S724 (V251-42): after a save the rental page reloads through a server
// redirect. Carry the tab the landlord was on (kept in ?tab= by the tab bar)
// from the page they saved on, so they land back where they were.

const TAB_RE = /^[a-z][a-z0-9_-]{0,23}$/;

export function tabFromReferer(referer: string | null | undefined, propertyId: string): string | null {
  if (!referer) return null;
  try {
    const u = new URL(referer);
    if (!u.pathname.endsWith(`/dashboard/properties/${propertyId}`)) return null;
    const t = u.searchParams.get("tab");
    return t && TAB_RE.test(t) ? t : null;
  } catch {
    return null;
  }
}
