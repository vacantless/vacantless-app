// S751 (Fable review, lower list): one dedicated key for the public signed links
// (viewing "Add to calendar", renter unsubscribe, the agent calendar feed and the
// Marketplace phone kit). They used the Supabase service-role key as the HMAC
// key, which ties every emailed link to the most powerful secret we hold.
//
// New links are signed with LINK_SIGNING_SECRET once it is set in Vercel. Links
// already sent (and calendar feeds people subscribed to) were signed with the
// old key, so verification also accepts the old keys until they are retired.
// Pure: env passed in for tests.

export function linkSigningSecret(env: Record<string, string | undefined> = process.env): string {
  return (env.LINK_SIGNING_SECRET || "").trim() || env.SUPABASE_SERVICE_ROLE_KEY || env.CRON_SECRET || "";
}

/** Every key a link may have been signed with, newest first, no blanks or repeats. */
export function linkVerifySecrets(env: Record<string, string | undefined> = process.env): string[] {
  const all = [(env.LINK_SIGNING_SECRET || "").trim(), env.SUPABASE_SERVICE_ROLE_KEY || "", env.CRON_SECRET || ""];
  return all.filter((s, i) => s && all.indexOf(s) === i);
}

/** The first non-null result of `verify` across the keys. */
export function verifyWithAnyKey<T>(
  verify: (secret: string) => T | null,
  env: Record<string, string | undefined> = process.env,
): T | null {
  for (const s of linkVerifySecrets(env)) {
    const v = verify(s);
    if (v) return v;
  }
  return null;
}
