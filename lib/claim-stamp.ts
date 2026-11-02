// S742c: claim before you send. Until now the sending sweeps (viewing
// reminders, renter follow-ups, onboarding emails, posted-results, the agent
// confirmation nudge, sign-in lost, the landlord campaign) sent first and wrote
// the "sent" stamp after. One timer means that is safe; two overlapping runs
// (a manual workflow_dispatch beside the pg_cron tick, a platform retry) send
// twice. Here the stamp is written FIRST with a condition that only one runner
// can satisfy; the loser sees zero rows and skips. If the send then fails, the
// caller releases the claim so the next run tries again.
//
// Pure data-access helpers; no email logic here.

type UpdateChain = {
  eq: (col: string, v: unknown) => UpdateChain;
  is: (col: string, v: null) => UpdateChain;
  or: (filters: string) => UpdateChain;
  select: (cols: string) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
};
type Client = { from: (table: string) => { update: (patch: Record<string, unknown>) => UpdateChain } };

export type ClaimOutcome = "claimed" | "taken" | "error";
export type ClaimResult = { outcome: ClaimOutcome; error?: string };

function applyMatch(chain: UpdateChain, match: Record<string, unknown>): UpdateChain {
  let c = chain;
  for (const [k, v] of Object.entries(match)) c = c.eq(k, v);
  return c;
}

/**
 * Claim a "sent at" column that must still be NULL. Writes the timestamp (plus
 * any extra fields) only when the column is null; returns "taken" when another
 * runner got there first.
 */
export async function claimNull(
  client: Client,
  table: string,
  match: Record<string, unknown>,
  column: string,
  extra: Record<string, unknown> = {},
  nowIso: string = new Date().toISOString(),
): Promise<ClaimResult> {
  try {
    const chain = applyMatch(client.from(table).update({ [column]: nowIso, ...extra }), match).is(column, null);
    const { data, error } = await chain.select(column);
    if (error) return { outcome: "error", error: error.message };
    return { outcome: (data?.length ?? 0) > 0 ? "claimed" : "taken" };
  } catch (e) {
    return { outcome: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Claim a step watermark: writes step (plus extra fields) only when the
 * current value is null or below it. Returns "taken" when the step is already
 * written (another runner, or an earlier run that crashed after sending).
 */
export async function claimStep(
  client: Client,
  table: string,
  match: Record<string, unknown>,
  stepColumn: string,
  step: number,
  extra: Record<string, unknown> = {},
): Promise<ClaimResult> {
  try {
    const chain = applyMatch(client.from(table).update({ [stepColumn]: step, ...extra }), match).or(
      `${stepColumn}.is.null,${stepColumn}.lt.${step}`,
    );
    const { data, error } = await chain.select(stepColumn);
    if (error) return { outcome: "error", error: error.message };
    return { outcome: (data?.length ?? 0) > 0 ? "claimed" : "taken" };
  } catch (e) {
    return { outcome: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Put the row back after a failed send so the next run tries again. */
export async function releaseClaim(
  client: Client,
  table: string,
  match: Record<string, unknown>,
  restore: Record<string, unknown>,
): Promise<void> {
  try {
    await applyMatch(client.from(table).update(restore), match).select(Object.keys(restore)[0] ?? "*");
  } catch {
    // Best effort: a release that fails leaves a stamp without a send, which
    // the next review catches; it never sends twice.
  }
}
