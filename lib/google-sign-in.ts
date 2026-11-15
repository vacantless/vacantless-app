// S800 (REVIEW-S799 item 7): where Google sends the visitor back. Pure, tested
// in scripts/test-google-sign-in.ts. Always our own /auth/callback, with `next`
// kept only when it is a page of the app (the same rule as lib/safe-next).
import { safeNextPath } from "@/lib/safe-next";

export function googleRedirectTo(origin: string, next: string | null | undefined): string {
  const url = new URL("/auth/callback", origin);
  url.searchParams.set("next", safeNextPath(next ?? null));
  return url.toString();
}

/**
 * Where a Google sign-up goes after Google: a team invite's ?next= when there
 * is one, otherwise onboarding with the referral and plan from /signup carried on.
 */
export function signupNext(search: string): string {
  const params = new URLSearchParams(search);
  const nextParam = params.get("next");
  if (nextParam && safeNextPath(nextParam) === nextParam) return nextParam;
  const qp = new URLSearchParams();
  const ref = params.get("ref");
  const plan = params.get("plan");
  if (ref) qp.set("ref", ref);
  if (plan) qp.set("plan", plan);
  const qs = qp.toString();
  return qs ? `/onboarding?${qs}` : "/onboarding";
}
