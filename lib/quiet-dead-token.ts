// S801 (REVIEW-S799 item 16): a browser that still carries a dead sign-in
// cookie makes Supabase log "Invalid Refresh Token: Refresh Token Not Found"
// as an error on every page it opens. The middleware already clears the dead
// cookie (S728); the log line is written inside the Supabase client before
// that runs. This drops only that one log line, so a real error is never hidden.

/** True when a console.error call is the dead-cookie refresh failure and nothing else. */
export function isDeadRefreshTokenLog(args: unknown[]): boolean {
  if (args.length !== 1) return false;
  const e = args[0] as { __isAuthError?: unknown; code?: unknown } | null | undefined;
  if (!e || typeof e !== "object") return false;
  return e.__isAuthError === true && e.code === "refresh_token_not_found";
}

const FLAG = "__vacantlessDeadTokenQuiet";

/** Installs the filter once per process. Safe to call on every import. */
export function quietDeadRefreshTokenLogs(): void {
  const g = globalThis as Record<string, unknown>;
  if (g[FLAG]) return;
  g[FLAG] = true;
  const real = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (isDeadRefreshTokenLog(args)) return;
    real(...args);
  };
}
