import { sourceLabelForPost } from "./listing-distribution";

type Env = Record<string, string | undefined>;
const DEFAULT_APP_URL = "https://vacantless-app.vercel.app";

export type LeadFallbackAttribution = {
  source: string;
  sourceDetail: string | null;
};

export function leadAttributionReferrerEnabled(
  env: Env = process.env,
): boolean {
  return env.LEAD_ATTRIBUTION_REFERRER_ENABLED === "1";
}

export function leadAttributionTrackedCopyEnabled(
  env: Env = process.env,
): boolean {
  return env.LEAD_ATTRIBUTION_TRACKED_COPY_ENABLED === "1";
}

export function normalizeLeadReferrerHost(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || /\s/.test(raw)) return null;

  let host = raw.toLowerCase();
  if (/^https?:\/\//i.test(raw)) {
    try {
      host = new URL(raw).hostname.toLowerCase();
    } catch {
      return null;
    }
  } else if (/[/?#]/.test(host)) {
    return null;
  }

  host = host.replace(/^www\./, "").replace(/\.$/, "");
  if (!host || host.length > 120 || /[\s/?#]/.test(host)) return null;
  return host;
}

export function isOwnLeadReferrerHost(
  value: unknown,
  env: Env = process.env,
): boolean {
  const host = normalizeLeadReferrerHost(value);
  if (!host) return false;
  if (ownLeadReferrerHosts(env).has(host)) return true;
  return (
    host === "vacantless-app.vercel.app" ||
    (host.startsWith("vacantless-app-") && host.endsWith(".vercel.app"))
  );
}

export function normalizeLeadAttributionReferrerHost(
  value: unknown,
  env: Env = process.env,
): string | null {
  const host = normalizeLeadReferrerHost(value);
  if (!host || isOwnLeadReferrerHost(host, env)) return null;
  return host;
}

export function normalizeLeadUtmSource(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase().replace(/^www\./, "");
  if (!raw || raw.length > 120 || /[\s/?#]/.test(raw)) return null;
  return raw;
}

export function leadSourceLabelForReferrerHost(host: unknown): string | null {
  const normalized = normalizeLeadReferrerHost(host);
  if (!normalized) return null;
  if (
    normalized === "facebook.com" ||
    normalized === "m.facebook.com" ||
    normalized === "l.facebook.com" ||
    normalized === "lm.facebook.com"
  ) {
    return sourceLabelForPost({ portal: "facebook" });
  }
  if (normalized === "kijiji.ca") return sourceLabelForPost({ portal: "kijiji" });
  if (normalized === "rentals.ca") {
    return sourceLabelForPost({ portal: "rentals_ca" });
  }
  if (normalized === "rentfaster.ca") {
    return sourceLabelForPost({ portal: "rentfaster" });
  }
  if (normalized === "zumper.com") return sourceLabelForPost({ portal: "zumper" });
  if (normalized === "viewit.ca") return sourceLabelForPost({ portal: "viewit" });
  if (normalized === "instagram.com") {
    return sourceLabelForPost({ portal: "instagram" });
  }
  if (
    normalized.startsWith("google.") ||
    normalized.startsWith("bing.") ||
    normalized.startsWith("duckduckgo.")
  ) {
    return "Search";
  }
  return null;
}

export function leadSourceLabelForUtmSource(source: unknown): string | null {
  const normalized = normalizeLeadUtmSource(source);
  if (!normalized) return null;
  switch (normalized) {
    case "facebook":
    case "facebook_marketplace":
    case "facebook-marketplace":
    case "facebook.com":
      return sourceLabelForPost({ portal: "facebook" });
    case "kijiji":
    case "kijiji.ca":
      return sourceLabelForPost({ portal: "kijiji" });
    case "rentals_ca":
    case "rentals-ca":
    case "rentals.ca":
      return sourceLabelForPost({ portal: "rentals_ca" });
    case "rentfaster":
    case "rentfaster.ca":
      return sourceLabelForPost({ portal: "rentfaster" });
    case "zumper":
    case "padmapper":
    case "zumper.com":
      return sourceLabelForPost({ portal: "zumper" });
    case "viewit":
    case "viewit.ca":
      return sourceLabelForPost({ portal: "viewit" });
    case "instagram":
    case "instagram.com":
      return sourceLabelForPost({ portal: "instagram" });
    case "google":
    case "bing":
    case "duckduckgo":
      return "Search";
    default:
      if (
        normalized.startsWith("google.") ||
        normalized.startsWith("bing.") ||
        normalized.startsWith("duckduckgo.")
      ) {
        return "Search";
      }
      return null;
  }
}

export function leadFallbackAttributionFromSignals(input: {
  referrerHost?: unknown;
  sourceHint?: unknown;
  utmSource?: unknown;
  env?: Env;
}): LeadFallbackAttribution {
  if (input.sourceHint === "network") {
    return { source: "vacantless_network", sourceDetail: null };
  }

  const utmSource = normalizeLeadUtmSource(input.utmSource);
  if (utmSource) {
    return {
      source: leadSourceLabelForUtmSource(utmSource) ?? "website",
      sourceDetail: `utm:${utmSource}`,
    };
  }

  const referrerHost = normalizeLeadAttributionReferrerHost(
    input.referrerHost,
    input.env,
  );
  if (referrerHost) {
    return {
      source: leadSourceLabelForReferrerHost(referrerHost) ?? "website",
      sourceDetail: `ref:${referrerHost}`,
    };
  }

  return { source: "website", sourceDetail: null };
}

function ownLeadReferrerHosts(env: Env): Set<string> {
  const hosts = new Set<string>();
  const appHost = normalizeLeadReferrerHost(
    env.NEXT_PUBLIC_APP_URL ?? DEFAULT_APP_URL,
  );
  addOwnHost(hosts, appHost);
  addOwnHost(hosts, "app.vacantless.com");
  addOwnHost(hosts, "vacantless.com");
  addOwnHost(hosts, "vacantless-app.vercel.app");
  return hosts;
}

function addOwnHost(hosts: Set<string>, host: string | null): void {
  if (!host) return;
  hosts.add(host);
  if (!host.endsWith(".vercel.app")) {
    const parts = host.split(".");
    if (parts.length > 2) hosts.add(parts.slice(-2).join("."));
  }
}
