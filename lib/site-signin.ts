// ============================================================================
// site-signin (S705). "Sign in once" for robot-posted sites, pure helpers.
//
// A landlord asks for a sign-in window; our worker on GitHub opens a real
// browser, shares its screen through a private link, and saves the session
// once the landlord has signed in by hand (vacantless-worker
// src/signin-window.ts). Kijiji and Zumper only: Rentals.ca's Cloudflare
// blocks the robot from GitHub (S703), so a session made there is no use.
// ============================================================================

export const SITE_SIGNIN_CHANNELS = ["kijiji", "zumper"] as const;
export type SiteSigninChannel = (typeof SITE_SIGNIN_CHANNELS)[number];

export const SITE_SIGNIN_LABEL: Record<SiteSigninChannel, string> = {
  kijiji: "Kijiji",
  zumper: "Zumper",
};

export function isSiteSigninChannel(v: unknown): v is SiteSigninChannel {
  return typeof v === "string" && (SITE_SIGNIN_CHANNELS as readonly string[]).includes(v);
}

/**
 * Dark until SITE_SIGNIN_ENABLED=true in Vercel. Our own team (platform
 * admins) can always open the page, so the window is proven on a real account
 * before any landlord is sent to it.
 */
export function siteSigninEnabled(
  opts: { isPlatformAdmin?: boolean } = {},
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.SITE_SIGNIN_ENABLED === "true" || opts.isPlatformAdmin === true;
}

/** Shown to every landlord only when the flag is on (links never point at a page they cannot open). */
export function siteSigninLinksOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.SITE_SIGNIN_ENABLED === "true";
}

export function siteSigninHref(channel: SiteSigninChannel): string {
  return `/dashboard/site-signin/${channel}`;
}

export type SiteSigninStatus =
  | "starting"
  | "ready"
  | "saving"
  | "done"
  | "failed"
  | "expired"
  | "cancelled";

export function siteSigninIsOpen(status: string | null | undefined): boolean {
  return status === "starting" || status === "ready" || status === "saving";
}

/** The window password rides in the link's #fragment; the page also shows it in case the viewer asks. */
export function siteSigninPassword(viewUrl: string | null | undefined): string | null {
  if (!viewUrl) return null;
  const hash = viewUrl.split("#")[1];
  if (!hash) return null;
  const pw = new URLSearchParams(hash).get("password");
  return pw && /^[A-Za-z0-9]{6,8}$/.test(pw) ? pw : null;
}

/** Only links our worker makes are ever shown as a button. */
export function siteSigninSafeViewUrl(viewUrl: string | null | undefined): string | null {
  if (!viewUrl) return null;
  try {
    const u = new URL(viewUrl);
    if (u.protocol !== "https:") return null;
    if (!/\.trycloudflare\.com$/i.test(u.hostname)) return null;
    if (u.pathname !== "/vnc.html") return null;
    return viewUrl;
  } catch {
    return null;
  }
}

export type SiteSigninView = {
  tone: "wait" | "action" | "ok" | "bad";
  title: string;
  body: string;
};

export function siteSigninView(
  channel: SiteSigninChannel,
  status: string | null,
  detail: string | null = null,
): SiteSigninView {
  const name = SITE_SIGNIN_LABEL[channel];
  switch (status) {
    case "starting":
      return {
        tone: "wait",
        title: "Opening a secure browser",
        body: "This takes about a minute. Keep this page open.",
      };
    case "ready":
      return {
        tone: "action",
        title: `Sign in to ${name}`,
        body:
          detail === "not_signed_in_yet"
            ? `We checked and ${name} does not show you as signed in yet. Finish signing in, then press the button again.`
            : `Open the window and sign in to your ${name} account. You type your password into ${name} itself, so it stays with you.`,
      };
    case "saving":
      return { tone: "wait", title: "Signed in. Saving", body: "One moment." };
    case "done":
      return {
        tone: "ok",
        title: `${name} is ready`,
        body: `We post your approved ads to ${name} from now on. You still approve each post.`,
      };
    case "expired":
      return {
        tone: "bad",
        title: "The window closed",
        body: "It stays open for 10 minutes. Try again when you are ready.",
      };
    case "cancelled":
      return { tone: "bad", title: "Stopped", body: "Your account stays as it was. Try again any time." };
    case "failed":
      return {
        tone: "bad",
        title: "The window did not open",
        body: "Your account stays as it was. Please try again in a minute.",
      };
    default:
      return {
        tone: "action",
        title: `Sign in to ${name} once`,
        body: `We open ${name} in a secure window. You sign in yourself, so your password stays with you. After that we post the ads you approve.`,
      };
  }
}
