// S705: ask GitHub to open a sign-in window (vacantless-worker
// .github/workflows/signin-window.yml), the same dispatch post-now.ts uses.
// Never throws. Returns false when the token is missing or GitHub refuses.
import { POST_NOW_REPO } from "./post-now";

export const SIGNIN_WINDOW_EVENT = "signin-window";

export function signinWindowRequest(
  token: string,
  windowId: string,
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
      body: JSON.stringify({ event_type: SIGNIN_WINDOW_EVENT, client_payload: { window_id: windowId } }),
      cache: "no-store",
    },
  };
}

export async function triggerSigninWindow(
  windowId: string,
  fetchImpl: typeof fetch = fetch,
  token: string | undefined = process.env.POST_NOW_GITHUB_TOKEN,
): Promise<boolean> {
  if (!token) return false;
  try {
    const { url, init } = signinWindowRequest(token, windowId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    return res.status === 204;
  } catch {
    return false;
  }
}
