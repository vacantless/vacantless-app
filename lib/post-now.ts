// post-now.ts (S702s). When a post is approved, ask GitHub to run the posting
// worker right away instead of waiting for its hourly check.
//
// Dark until POST_NOW_GITHUB_TOKEN is set in Vercel (a fine-grained token with
// Actions: write on vacantless/vacantless-worker only). Never throws and never
// blocks the approval: the hourly check is the fallback either way.
export const POST_NOW_REPO = process.env.POST_NOW_REPO || "vacantless/vacantless-worker";
export const POST_NOW_EVENT = "post-now";

export function postNowRequest(token: string, repo: string = POST_NOW_REPO): {
  url: string;
  init: RequestInit;
} {
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
      body: JSON.stringify({ event_type: POST_NOW_EVENT }),
      cache: "no-store",
    },
  };
}

export async function triggerPostNow(
  fetchImpl: typeof fetch = fetch,
  token: string | undefined = process.env.POST_NOW_GITHUB_TOKEN,
): Promise<boolean> {
  if (!token) return false;
  try {
    const { url, init } = postNowRequest(token);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    return res.status === 204;
  } catch {
    return false;
  }
}
