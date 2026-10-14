// S705: ask GitHub to open a sign-in window (vacantless-worker
// .github/workflows/signin-window.yml), the same dispatch post-now.ts uses.
// Never throws. Returns false when the token is missing or GitHub refuses.
import { POST_NOW_REPO } from "./post-now";
import { signinOpensAtHome, type SiteSigninChannel } from "./site-signin";

export const SIGNIN_WINDOW_EVENT = "signin-window";
// S717: Rentals.ca's window opens on the home runner (signin-window-home.yml).
export const SIGNIN_WINDOW_HOME_EVENT = "signin-window-home";

/** Which worker workflow opens this site's window. Pure. */
export function signinWindowEvent(channel: SiteSigninChannel): string {
  return signinOpensAtHome(channel) ? SIGNIN_WINDOW_HOME_EVENT : SIGNIN_WINDOW_EVENT;
}
// S706: a "Checking" tile asks the worker to run session-check.yml now
// instead of waiting for the daily 10:41 UTC run.
export const SESSION_CHECK_EVENT = "session-check";

export function githubDispatchRequest(
  token: string,
  eventType: string,
  clientPayload: Record<string, unknown>,
  repo: string = POST_NOW_REPO,
): { url: string; init: RequestInit } {
  return {
    url: `https://api.github.com/repos/${repo}/dispatches`,
    init: {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event_type: eventType, client_payload: clientPayload }),
      cache: "no-store",
    },
  };
}

export function signinWindowRequest(
  token: string,
  windowId: string,
  repo: string = POST_NOW_REPO,
  channel: SiteSigninChannel = "kijiji",
): { url: string; init: RequestInit } {
  return githubDispatchRequest(token, signinWindowEvent(channel), { window_id: windowId }, repo);
}

async function send(
  req: { url: string; init: RequestInit },
  fetchImpl: typeof fetch,
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetchImpl(req.url, { ...req.init, signal: controller.signal });
    clearTimeout(timer);
    return res.status === 204;
  } catch {
    return false;
  }
}

export async function triggerSigninWindow(
  windowId: string,
  channel: SiteSigninChannel,
  fetchImpl: typeof fetch = fetch,
  token: string | undefined = process.env.POST_NOW_GITHUB_TOKEN,
): Promise<boolean> {
  if (!token) return false;
  return send(signinWindowRequest(token, windowId, POST_NOW_REPO, channel), fetchImpl);
}

export function sessionCheckRequest(
  token: string,
  orgId: string,
  channels: readonly string[],
  repo: string = POST_NOW_REPO,
): { url: string; init: RequestInit } {
  return githubDispatchRequest(token, SESSION_CHECK_EVENT, { org_id: orgId, channels: [...channels] }, repo);
}

export async function triggerSessionCheck(
  orgId: string,
  channels: readonly string[],
  fetchImpl: typeof fetch = fetch,
  token: string | undefined = process.env.POST_NOW_GITHUB_TOKEN,
): Promise<boolean> {
  if (!token || channels.length === 0) return false;
  return send(sessionCheckRequest(token, orgId, channels), fetchImpl);
}
