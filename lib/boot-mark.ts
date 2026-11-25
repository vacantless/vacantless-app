// S841e: a short-lived measurement (WORKFLOW 418). The /warm ping did not make
// the first dashboard load fast, so each logs which server copy answered and
// how long that copy has been up. Same boot id = one copy serves both; a small
// "up" on the dashboard = that load paid for a cold start. Removed once read.
const g = globalThis as { __vlBootId?: string };
g.__vlBootId ??= Math.random().toString(36).slice(2, 8);

export function bootMark(where: string): string {
  return `[s841-boot] ${where} boot=${g.__vlBootId} up=${Math.round(process.uptime() * 1000)}`;
}
