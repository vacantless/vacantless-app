// ============================================================================
// site-signin (S705). "Sign in once" for robot-posted sites, pure helpers.
//
// A landlord asks for a sign-in window; our worker on GitHub opens a real
// browser, shares its screen through a private link, and saves the session
// once the landlord has signed in by hand (vacantless-worker
// src/signin-window.ts). Kijiji and Zumper open on GitHub. S717: Rentals.ca's
// Cloudflare blocks GitHub (S703), so its window opens on the home runner
// (a computer with a home connection) instead; see SIGNIN_AT_HOME.
// ============================================================================

export const SITE_SIGNIN_CHANNELS = ["kijiji", "zumper", "rentals_ca"] as const;
export type SiteSigninChannel = (typeof SITE_SIGNIN_CHANNELS)[number];

export const SITE_SIGNIN_LABEL: Record<SiteSigninChannel, string> = {
  kijiji: "Kijiji",
  zumper: "Zumper",
  rentals_ca: "Rentals.ca",
};

/** S717: sites whose window opens on the home runner (worker signin-window-home.yml). */
export const SIGNIN_AT_HOME: readonly SiteSigninChannel[] = ["rentals_ca"];
export function signinOpensAtHome(channel: SiteSigninChannel): boolean {
  return SIGNIN_AT_HOME.includes(channel);
}

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

/**
 * S712 (Codex review): the status a Settings site-account Save writes back.
 * With "Sign in once" on, the sign-in page owns the account, so a Save of the
 * paid-ad limits keeps the status as it is; flipping not_started to
 * needs_login would turn an unconnected tile into "Sign in again".
 * Flag off = the old rule (naming an account for the first time waits on a sign-in).
 */
export function settingsAccountStatusToSave(
  accountStatus: string,
  signinLinksOn: boolean,
): string {
  if (signinLinksOn) return accountStatus;
  return accountStatus === "not_started" ? "needs_login" : accountStatus;
}

/**
 * S714: sign-in only works with an account that can post. Zumper turns a
 * renter account into a landlord account only after an ID check (S713), so a
 * landlord without one must make it on Zumper before the window is any use.
 */
export const SITE_SIGNIN_ACCOUNT_FIRST: Record<
  SiteSigninChannel,
  { text: string; href: string; linkLabel: string }
> = {
  kijiji: {
    text: "You need a Kijiji account. No account yet? Make it with us below, or on Kijiji.",
    href: "https://www.kijiji.ca/",
    linkLabel: "Open Kijiji",
  },
  zumper: {
    text: "You need a Zumper landlord account. Zumper checks your ID before you can post. No account yet? Make it with us below, or on Zumper.",
    href: "https://www.zumper.com/manage",
    linkLabel: "Open Zumper",
  },
  rentals_ca: {
    text: "You need a Rentals.ca account. No account yet? Make it with us below, or on Rentals.ca. If Rentals.ca sends you a code, type it in the window.",
    href: "https://rentals.ca/",
    linkLabel: "Open Rentals.ca",
  },
};

// S724 (V251-18): carry the rental the landlord came from, so the way back
// returns to it. Only a well-formed id is passed on; pages check ownership.
const PROPERTY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function cleanPropertyId(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return PROPERTY_ID_RE.test(s) ? s.toLowerCase() : null;
}

export function siteSigninHref(channel: SiteSigninChannel, propertyId?: string | null): string {
  const id = cleanPropertyId(propertyId);
  return `/dashboard/site-signin/${channel}${id ? `?property=${id}` : ""}`;
}

/** Add a query flag to a site-signin href that may already carry ?property=. */
export function withQuery(href: string, key: string, value: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
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
          detail === "enter_code"
            ? `${name} just emailed you a code. Type it into the box in the window. Then press Submit there. We do the rest.`
            : detail === "not_signed_in_yet"
              ? `We checked and ${name} does not show you as signed in yet. Finish signing in, then press the button again.`
              : detail === "signup_filled"
                ? `We opened the ${name} sign-up page and filled in your details. Choose a password and finish the steps there. You type your password into ${name} itself, so it stays with you.`
                : detail === "signup_open"
                  ? `We opened the ${name} sign-up page. Fill it in and finish the steps there. Your password stays with you.`
                  : detail === "signup_link_missing"
                    ? `Press Sign up in the window, then make your ${name} account there. Your password stays with you.`
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
      // S738: one Rentals.ca account per Vacantless account.
      if (detail === "account_shared") {
        return {
          tone: "bad",
          title: `That ${name} account is already in use`,
          body: `Another Vacantless account already posts from this ${name} account. Sharing it would switch off each other's ads, so we did not save it. Sign in with a ${name} account only you use.`,
        };
      }
      return {
        tone: "bad",
        title: "The window did not open",
        body:
          detail === "did_not_open"
            ? "We waited three minutes with no sign-in, so we closed the window. Your account stays as it was. Try again. If it happens twice, email hello@vacantless.com and we will open it for you."
            : "Your account stays as it was. Please try again in a minute.",
      };
    default:
      return {
        tone: "action",
        title: `Sign in to ${name} once`,
        body: `We open ${name} in a secure window. You sign in yourself, so your password stays with you. After that we post the ads you approve.`,
      };
  }
}

// ---- S735 (review item 7): sign in to all three in one sitting ------------
// One screen runs the sign-ins back to back: Kijiji, Rentals.ca, Zumper. When
// a window finishes, the next site's window opens by itself. A Rentsync-style
// feed is closed to us, so this is the ceiling for the three robot sites.

/** The order the chain runs. Kijiji first: it is where most renters are. */
export const SITE_SIGNIN_ORDER: readonly SiteSigninChannel[] = ["kijiji", "rentals_ca", "zumper"];

export type SiteSigninChainStep = {
  channel: SiteSigninChannel;
  label: string;
  /** done = a session we can post from; todo = needs a sign-in; off = hidden for this org. */
  state: "done" | "todo" | "off";
};

/** A tile state that means "no usable session yet". */
export function signinNeeded(tileState: string | null | undefined): boolean {
  return tileState === "not_linked" || tileState === "dead_session" || tileState === "connected_needs_authorization";
}

export function buildSigninChain(
  tileStateByChannel: Readonly<Record<string, string | null | undefined>>,
  hiddenFor: (channel: SiteSigninChannel) => boolean = () => false,
): SiteSigninChainStep[] {
  return SITE_SIGNIN_ORDER.map((channel) => ({
    channel,
    label: SITE_SIGNIN_LABEL[channel],
    state: hiddenFor(channel) ? "off" : signinNeeded(tileStateByChannel[channel]) ? "todo" : "done",
  }));
}

/** The next site still to sign in to, after `after` (or the first one when `after` is null). */
export function nextSigninChannel(
  chain: readonly SiteSigninChainStep[],
  after: SiteSigninChannel | null,
): SiteSigninChannel | null {
  const start = after ? SITE_SIGNIN_ORDER.indexOf(after) + 1 : 0;
  for (let i = start; i < SITE_SIGNIN_ORDER.length; i++) {
    const step = chain.find((s) => s.channel === SITE_SIGNIN_ORDER[i]);
    if (step && step.state === "todo") return step.channel;
  }
  return null;
}

/** "2 of 3 sites still need a sign-in" for the one-sitting screen. */
export function signinChainSummary(chain: readonly SiteSigninChainStep[]): string {
  const shown = chain.filter((s) => s.state !== "off");
  const todo = shown.filter((s) => s.state === "todo").length;
  if (shown.length === 0) return "No sites to sign in to.";
  if (todo === 0) return "You are signed in to every site. We post your approved ads from now on.";
  if (todo === shown.length) return `Sign in to ${shown.length} sites, one after the other. About ${shown.length * 2} minutes.`;
  return `${todo} of ${shown.length} sites still need a sign-in.`;
}

// ---- S736 (review item 7 second half): "create the account for me" -------
// A landlord with no account presses "Make my <site> account". The same
// window opens on the site's sign-up page with these details filled in; the
// landlord chooses the password and finishes (worker signup-prefill-logic).

/** What each site still asks of the landlord after we fill the form. */
export const SITE_SIGNUP_NOTE: Record<SiteSigninChannel, string> = {
  kijiji: "Kijiji may email you a link to confirm your address. Open it, then come back to the window.",
  zumper: "Zumper also checks your ID before you can post. If that takes a while, sign in here once Zumper approves you.",
  rentals_ca: "Rentals.ca emails you a code. Type it in the window.",
};

export type SignupPrefill = { first_name: string | null; last_name: string | null; email: string | null; phone: string | null };

/** The details the landlord typed, cleaned. Null email = nothing worth sending. */
export function cleanSignupPrefill(input: {
  first_name?: unknown;
  last_name?: unknown;
  email?: unknown;
  phone?: unknown;
}): SignupPrefill {
  const clean = (v: unknown, max: number) => {
    const t = typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max) : "";
    return t || null;
  };
  const email = clean(input.email, 120);
  const phone = clean(input.phone, 30);
  return {
    first_name: clean(input.first_name, 60),
    last_name: clean(input.last_name, 60),
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : null,
    phone: phone && phone.replace(/\D/g, "").length >= 10 ? phone : null,
  };
}
