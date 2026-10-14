// S716: emailed links survive a login. Run: tsx scripts/test-s716-login-next.ts
import { safeNextPath, nextParamFor } from "../lib/safe-next";
let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) pass++; else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
const renew = "/dashboard/properties/1c429911-8d74-4e84-89d8-78f6c92c2a0e?tab=distribute";
eq("renew link kept", safeNextPath(renew), renew);
eq("lead link kept", safeNextPath("/dashboard/leads/abc"), "/dashboard/leads/abc");
eq("onboarding kept", safeNextPath("/onboarding"), "/onboarding");
eq("empty", safeNextPath(""), "/dashboard");
eq("null", safeNextPath(null), "/dashboard");
eq("other site", safeNextPath("https://evil.example/dashboard"), "/dashboard");
eq("protocol-relative", safeNextPath("//evil.example/dashboard"), "/dashboard");
eq("backslash", safeNextPath("/\\evil.example"), "/dashboard");
eq("public page refused", safeNextPath("/pricing"), "/dashboard");
eq("lookalike prefix", safeNextPath("/dashboardx"), "/dashboard");
eq("control char", safeNextPath("/dashboard\n/x"), "/dashboard");
eq("nextParamFor renew", nextParamFor("/dashboard/properties/1c42", "?tab=distribute"), "/dashboard/properties/1c42?tab=distribute");
eq("nextParamFor home is null", nextParamFor("/dashboard", ""), null);
eq("nextParamFor no search", nextParamFor("/dashboard/leads/abc", ""), "/dashboard/leads/abc");
console.log(`s716-login-next: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
