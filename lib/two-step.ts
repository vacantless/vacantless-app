// S803: two-step sign-in (REVIEW-S799 item 11, plan claude/PLAN-S803-TWO-STEP-SIGNIN.md).
// Offered to every login, never required. A login that has turned it on must
// type the 6-digit code from its phone after the password or Google sign-in,
// before any account page opens. Pure; tested by scripts/test-two-step.ts.

/** Pages that need the code once a login has turned two-step on. */
const GATED_PREFIXES = ["/dashboard", "/onboarding", "/join"];

/** Where the code is typed. */
export const CODE_PAGE = "/login/code";

export type AssuranceLevel = string | null | undefined;

export function isGatedPath(pathname: string): boolean {
  return GATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * "verify" when this login has a code set up (next level aal2) but this
 * sign-in has not typed it yet (current level below aal2), on a gated page.
 */
export function twoStepDecision(input: {
  pathname: string;
  currentLevel: AssuranceLevel;
  nextLevel: AssuranceLevel;
}): "allow" | "verify" {
  if (!isGatedPath(input.pathname)) return "allow";
  if (input.nextLevel !== "aal2") return "allow";
  if (input.currentLevel === "aal2") return "allow";
  return "verify";
}

/** A 6-digit code as typed (spaces and dashes dropped), or null. */
export function cleanCode(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** The line shown on My settings: stronger when the account collects rent. */
export function twoStepPitch(collectsRent: boolean): string {
  return collectsRent
    ? "You collect rent here. Ask for a code from your phone at sign-in. Then a stolen password is not enough."
    : "Ask for a code from your phone at sign-in. Then a stolen password is not enough.";
}
