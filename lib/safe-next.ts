// S716: where to send someone after they log in. An emailed link (a new
// inquiry, a booked viewing, "Renew your ads") opened while signed out used to
// land on /login with the path dropped, so after logging in the reader got the
// dashboard home instead of the page the email promised. The middleware now
// passes the page as ?next=, and the login page returns there.
//
// Only same-site app pages are allowed (no "//host", no "https://", no
// backslash tricks), so ?next= can never send someone to another site.
const ALLOWED_PREFIXES = ["/dashboard", "/onboarding"];

export const DEFAULT_AFTER_LOGIN = "/dashboard";

/** A safe in-app path to go to after login, or /dashboard. Pure. */
export function safeNextPath(raw: string | null | undefined): string {
  const next = (raw ?? "").trim();
  if (!next.startsWith("/")) return DEFAULT_AFTER_LOGIN;
  if (next.startsWith("//") || next.includes("\\")) return DEFAULT_AFTER_LOGIN;
  if (/[\u0000-\u001f]/.test(next)) return DEFAULT_AFTER_LOGIN;
  const pathOnly = next.split(/[?#]/)[0];
  const ok = ALLOWED_PREFIXES.some(
    (p) => pathOnly === p || pathOnly.startsWith(`${p}/`),
  );
  return ok ? next : DEFAULT_AFTER_LOGIN;
}

/** The ?next= value for a protected page someone was sent to. Pure. */
export function nextParamFor(pathname: string, search: string): string | null {
  const value = `${pathname}${search ?? ""}`;
  return safeNextPath(value) === value && value !== DEFAULT_AFTER_LOGIN ? value : null;
}
