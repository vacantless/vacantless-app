import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { channelByKey, type DistributionChannel } from "./distribution-channels";

export const RELIST_RADAR_TEST_ORG_ID = "8ea1da48-0cd2-45a4-bfba-023b31a67884";
export const RELIST_RADAR_BLOCKED_ORG_IDS = new Set([
  "921f7c08-98af-428f-a238-36f4a781b0de",
]);
export const RELIST_RADAR_EMAIL_EVENT_KEY = "leasing.relist_radar";
export const RELIST_RADAR_LAST_CHANCE_EVENT_KEY =
  "leasing.relist_radar_last_chance";
export const RELIST_RADAR_PAID_LAPSE_EVENT_KEY =
  "leasing.relist_radar_paid_lapse";
export const RELIST_RADAR_AUTOPILOT_RECAP_EVENT_KEY =
  "leasing.relist_radar_autopilot_recap";
export const RELIST_RADAR_DECISION_TOKEN_TTL_MS = 7 * 86_400_000;

export const RELIST_RADAR_DECISION_ACTIONS = [
  "skip",
  "consent",
  "keep_live",
  "let_expire",
] as const;
export type RelistRadarDecisionAction =
  (typeof RELIST_RADAR_DECISION_ACTIONS)[number];

export const RELIST_RADAR_DECISIONS = [
  "skipped",
  "paid_consented",
  "kept_live",
  "let_expire",
  "no_response",
] as const;
export type RelistRadarDecision = (typeof RELIST_RADAR_DECISIONS)[number];

export type RelistRadarEmailKind = "notice" | "last_chance" | "paid_lapse";
export type RelistRadarEmailLocale = "en" | "fr";

export type RelistRadarSettings = {
  notify_lead_days: number;
  refresh_now_semantics: "confirm_run_on_scheduled_day";
  free_skip_behavior: "last_chance_then_lapse";
  paid_lapse_followup: "nudge";
  execution_time: "expiry_day_morning";
  email_grouping: "combined_per_property";
  autopilot_receipt: "monthly";
};

export const RELIST_RADAR_DEFAULT_SETTINGS: RelistRadarSettings = {
  notify_lead_days: 3,
  refresh_now_semantics: "confirm_run_on_scheduled_day",
  free_skip_behavior: "last_chance_then_lapse",
  paid_lapse_followup: "nudge",
  execution_time: "expiry_day_morning",
  email_grouping: "combined_per_property",
  autopilot_receipt: "monthly",
};

type RelistRadarStringSettingKey = Exclude<
  keyof RelistRadarSettings,
  "notify_lead_days"
>;

const RELIST_RADAR_ALLOWED: {
  [K in RelistRadarStringSettingKey]: readonly RelistRadarSettings[K][];
} = {
  refresh_now_semantics: ["confirm_run_on_scheduled_day"],
  free_skip_behavior: ["last_chance_then_lapse"],
  paid_lapse_followup: ["nudge"],
  execution_time: ["expiry_day_morning"],
  email_grouping: ["combined_per_property"],
  autopilot_receipt: ["monthly"],
};

export type RelistRadarClockUpdate = {
  external_posted_at?: string;
  external_expires_at?: string | null;
};

export type RelistRadarClassification =
  | {
      kind: "radar_candidate";
      daysToExpiry: number;
      cycleDate: string;
    }
  | {
      kind:
        | "leased"
        | "not_available"
        | "unknown_ttl"
        | "missing_expiry"
        | "invalid_expiry"
        | "out_of_window";
      daysToExpiry: number | null;
      cycleDate: string | null;
    };

function clean(value: string | null | undefined): string | null {
  const v = String(value ?? "").trim();
  return v || null;
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.trunc(value);
  return rounded > 0 ? rounded : null;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function oneOf<K extends RelistRadarStringSettingKey>(
  key: K,
  value: unknown,
): RelistRadarSettings[K] {
  const allowed = RELIST_RADAR_ALLOWED[key] as readonly string[];
  const fallback = RELIST_RADAR_DEFAULT_SETTINGS[key];
  return (
    typeof value === "string" && allowed.includes(value)
      ? value
      : fallback
  ) as RelistRadarSettings[K];
}

function parseTime(value: string | null | undefined): number | null {
  const cleanValue = clean(value);
  if (!cleanValue) return null;
  const time = Date.parse(cleanValue);
  return Number.isNaN(time) ? null : time;
}

export function resolveRelistRadarSettings(
  settingsJson: unknown,
): RelistRadarSettings {
  const raw = jsonObject(settingsJson);
  return {
    notify_lead_days:
      positiveInteger(raw.notify_lead_days) ??
      RELIST_RADAR_DEFAULT_SETTINGS.notify_lead_days,
    refresh_now_semantics: oneOf("refresh_now_semantics", raw.refresh_now_semantics),
    free_skip_behavior: oneOf("free_skip_behavior", raw.free_skip_behavior),
    paid_lapse_followup: oneOf("paid_lapse_followup", raw.paid_lapse_followup),
    execution_time: oneOf("execution_time", raw.execution_time),
    email_grouping: oneOf("email_grouping", raw.email_grouping),
    autopilot_receipt: oneOf("autopilot_receipt", raw.autopilot_receipt),
  };
}

export function relistRadarOrgAllowed(organizationId: string | null | undefined): boolean {
  const orgId = clean(organizationId);
  return orgId === RELIST_RADAR_TEST_ORG_ID && !RELIST_RADAR_BLOCKED_ORG_IDS.has(orgId);
}

export function relistRadarDecisionForAction(
  action: RelistRadarDecisionAction,
): RelistRadarDecision {
  switch (action) {
    case "skip":
      return "skipped";
    case "consent":
      return "paid_consented";
    case "keep_live":
      return "kept_live";
    case "let_expire":
      return "let_expire";
  }
}

export function isRelistRadarDecisionAction(
  value: unknown,
): value is RelistRadarDecisionAction {
  return (
    typeof value === "string" &&
    (RELIST_RADAR_DECISION_ACTIONS as readonly string[]).includes(value)
  );
}

export type RelistRadarDecisionTokenPayload = {
  v: 1;
  run_item_id: string;
  portal: string;
  action: RelistRadarDecisionAction;
  cycle_date: string;
  exp: number;
  nonce: string;
};

export type RelistRadarCreatedDecisionToken = {
  token: string;
  tokenHash: string;
  payload: RelistRadarDecisionTokenPayload;
  expiresAt: string;
};

export type RelistRadarDecisionTokenVerification =
  | {
      ok: true;
      tokenHash: string;
      payload: RelistRadarDecisionTokenPayload;
    }
  | {
      ok: false;
      reason:
        | "missing_secret"
        | "malformed"
        | "tampered"
        | "expired"
        | "unsupported_action";
    };

export function relistRadarDecisionTokenSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return clean(env.RELIST_RADAR_TOKEN_SECRET) ?? clean(env.CRON_SECRET);
}

function signRelistRadarBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function equalSignature(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function relistRadarDecisionTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createRelistRadarDecisionToken({
  runItemId,
  portal,
  action,
  cycleDate,
  secret,
  nowMs = Date.now(),
  ttlMs = RELIST_RADAR_DECISION_TOKEN_TTL_MS,
}: {
  runItemId: string;
  portal: string;
  action: RelistRadarDecisionAction;
  cycleDate: string;
  secret: string;
  nowMs?: number;
  ttlMs?: number;
}): RelistRadarCreatedDecisionToken {
  const payload: RelistRadarDecisionTokenPayload = {
    v: 1,
    run_item_id: runItemId,
    portal,
    action,
    cycle_date: cycleDate,
    exp: nowMs + ttlMs,
    nonce: randomBytes(12).toString("base64url"),
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const token = `${body}.${signRelistRadarBody(body, secret)}`;
  return {
    token,
    tokenHash: relistRadarDecisionTokenHash(token),
    payload,
    expiresAt: new Date(payload.exp).toISOString(),
  };
}

function validCycleDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function tokenPayloadFromUnknown(
  value: unknown,
): RelistRadarDecisionTokenPayload | null {
  const raw = jsonObject(value);
  if (raw.v !== 1) return null;
  if (!clean(raw.run_item_id as string | null | undefined)) return null;
  if (!clean(raw.portal as string | null | undefined)) return null;
  if (!validCycleDate(raw.cycle_date)) return null;
  if (typeof raw.exp !== "number" || !Number.isFinite(raw.exp)) return null;
  if (!clean(raw.nonce as string | null | undefined)) return null;
  if (!isRelistRadarDecisionAction(raw.action)) return null;
  return {
    v: 1,
    run_item_id: raw.run_item_id as string,
    portal: raw.portal as string,
    action: raw.action,
    cycle_date: raw.cycle_date,
    exp: raw.exp,
    nonce: raw.nonce as string,
  };
}

export function verifyRelistRadarDecisionToken(
  token: string | null | undefined,
  secret: string | null | undefined,
  nowMs = Date.now(),
): RelistRadarDecisionTokenVerification {
  if (!secret?.trim()) return { ok: false, reason: "missing_secret" };
  const [body, signature, extra] = String(token ?? "").split(".");
  if (!body || !signature || extra != null) return { ok: false, reason: "malformed" };
  const expected = signRelistRadarBody(body, secret);
  if (!equalSignature(expected, signature)) return { ok: false, reason: "tampered" };

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const payload = tokenPayloadFromUnknown(parsed);
    if (!payload) {
      return isRelistRadarDecisionAction(jsonObject(parsed).action)
        ? { ok: false, reason: "malformed" }
        : { ok: false, reason: "unsupported_action" };
    }
    if (payload.exp < nowMs) return { ok: false, reason: "expired" };
    return {
      ok: true,
      tokenHash: relistRadarDecisionTokenHash(String(token)),
      payload,
    };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

export function relistRadarManageUrl(appUrl: string, propertyId: string): string {
  return `${appUrl.replace(/\/+$/, "")}/dashboard/properties/${encodeURIComponent(
    propertyId,
  )}?tab=distribute#distribute`;
}

export function relistRadarEmailChannelIncluded(
  channel: Pick<DistributionChannel, "mode" | "paid"> | null | undefined,
): boolean {
  if (!channel) return false;
  return channel.paid || channel.mode !== "api_automatic";
}

export type RelistRadarChannelAccountConsent = {
  automation_authorized?: boolean | null;
  auto_submit_allowed?: boolean | null;
};

export function relistRadarStandingAutoRefreshConsent(
  account: RelistRadarChannelAccountConsent | null | undefined,
): boolean {
  return (
    account?.automation_authorized === true &&
    account.auto_submit_allowed === true
  );
}

export type RelistRadarFreeExecutionGateInput = {
  channelKey: string | null | undefined;
  paid: boolean;
  decision: string | null | undefined;
  propertyStatus: string | null | undefined;
  cycleDate: string | null | undefined;
  today: string;
  automationAuthorized: boolean;
  accountStatus: string | null | undefined;
  standingConsent: boolean;
  alreadyEnqueued: boolean;
};

export type RelistRadarFreeExecutionGate = {
  shouldEnqueue: boolean;
  reason: string;
  standingConsent: boolean;
};

export function relistRadarFreeExecutionGate({
  channelKey,
  paid,
  decision,
  propertyStatus,
  cycleDate,
  today,
  automationAuthorized,
  accountStatus,
  standingConsent,
  alreadyEnqueued,
}: RelistRadarFreeExecutionGateInput): RelistRadarFreeExecutionGate {
  const channel = channelByKey(channelKey);
  const normalizedDecision = clean(decision);
  const status = clean(propertyStatus)?.toLowerCase() ?? null;
  const cycle = clean(cycleDate);
  const todayDate = clean(today);

  if (alreadyEnqueued) {
    return { shouldEnqueue: false, reason: "already_enqueued", standingConsent };
  }
  if (!channel || channel.key !== "kijiji") {
    return {
      shouldEnqueue: false,
      reason: "unsupported_free_worker_channel",
      standingConsent,
    };
  }
  if (paid || channel.paid) {
    return { shouldEnqueue: false, reason: "paid_out_of_scope", standingConsent };
  }
  if (status !== "available") {
    return { shouldEnqueue: false, reason: "property_not_available", standingConsent };
  }
  if (!cycle || !todayDate || cycle > todayDate) {
    return { shouldEnqueue: false, reason: "not_expiry_day", standingConsent };
  }
  if (normalizedDecision === "skipped" || normalizedDecision === "let_expire") {
    return { shouldEnqueue: false, reason: "owner_vetoed", standingConsent };
  }
  if (!automationAuthorized) {
    return { shouldEnqueue: false, reason: "automation_not_authorized", standingConsent };
  }
  if (clean(accountStatus) !== "connected") {
    return { shouldEnqueue: false, reason: "account_not_connected", standingConsent };
  }
  if (
    standingConsent ||
    normalizedDecision == null ||
    normalizedDecision === "no_response" ||
    normalizedDecision === "kept_live"
  ) {
    return {
      shouldEnqueue: true,
      reason: standingConsent ? "standing_autopilot" : "free_auto_with_veto",
      standingConsent,
    };
  }
  return { shouldEnqueue: false, reason: "decision_not_executable", standingConsent };
}

export type RelistRadarEmailItem = {
  runItemId: string;
  channel: string;
  channelLabel: string;
  paid: boolean;
  cycleDate: string;
  externalExpiresAt: string;
  feeLabel?: string | null;
  feeCents?: number | null;
  actionUrls: {
    skip?: string | null;
    consent?: string | null;
    keepLive?: string | null;
    letExpire?: string | null;
    manage: string;
  };
};

export type RelistRadarEmailButton = {
  label: string;
  url: string;
  variant?: "primary" | "secondary";
};

export type RelistRadarBuiltEmail = {
  subject: string;
  body: string;
  dashboardUrl: string;
  summaryText: string;
  detailsText: string;
  actions: RelistRadarEmailButton[];
};

export type RelistRadarAutopilotRecapItem = {
  propertyAddress: string;
  propertyId: string;
  channelLabel: string;
  cycleDate: string;
  enqueuedAt: string;
  dashboardUrl: string;
};

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function localeOf(locale: RelistRadarEmailLocale | null | undefined): RelistRadarEmailLocale {
  return locale === "fr" ? "fr" : "en";
}

function dateLabel(cycleDate: string, locale: RelistRadarEmailLocale): string {
  const time = Date.parse(`${cycleDate}T00:00:00.000Z`);
  if (Number.isNaN(time)) return cycleDate;
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(time));
}

function moneyLabel(cents: number, locale: RelistRadarEmailLocale): string {
  return new Intl.NumberFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(cents / 100);
}

function feeLabel(item: RelistRadarEmailItem, locale: RelistRadarEmailLocale): string {
  const label = clean(item.feeLabel);
  if (label) return label;
  if (typeof item.feeCents === "number" && Number.isFinite(item.feeCents)) {
    return moneyLabel(item.feeCents, locale);
  }
  return locale === "fr" ? "les frais du site" : "the site fee";
}

function actionUrl(value: string | null | undefined): string | null {
  return clean(value);
}

function noticeLine(item: RelistRadarEmailItem, locale: RelistRadarEmailLocale): string {
  const expiry = dateLabel(item.cycleDate, locale);
  if (locale === "fr") {
    if (item.paid) {
      return `- ${item.channelLabel} expire le ${expiry}. Rafraichir pour ${feeLabel(
        item,
        locale,
      )}? Le bouton enregistre seulement le consentement au rafraichissement payant.`;
    }
    return `- ${item.channelLabel} expire le ${expiry}. Parcours prevu: rafraichissement automatique le matin de l'expiration, sauf si vous ignorez cette annonce.`;
  }
  if (item.paid) {
    return `- ${item.channelLabel} expires on ${expiry}. Refresh for ${feeLabel(
      item,
      locale,
    )}? The button records paid-refresh consent only.`;
  }
  return `- ${item.channelLabel} expires on ${expiry}. Planned path: auto-refresh on the expiry-day morning unless you skip this one.`;
}

function lastChanceLine(
  item: RelistRadarEmailItem,
  locale: RelistRadarEmailLocale,
): string {
  const expiry = dateLabel(item.cycleDate, locale);
  return locale === "fr"
    ? `- ${item.channelLabel} expire le ${expiry}. Choisissez Garder en ligne ou Laisser expirer pour clore ce cycle.`
    : `- ${item.channelLabel} expires on ${expiry}. Choose Keep it live or Let it expire to close this cycle.`;
}

function paidLapseLine(
  item: RelistRadarEmailItem,
  locale: RelistRadarEmailLocale,
): string {
  const expiry = dateLabel(item.cycleDate, locale);
  return locale === "fr"
    ? `- ${item.channelLabel} a expire le ${expiry}. Aucun consentement payant n'a ete enregistre.`
    : `- ${item.channelLabel} expired on ${expiry}. No paid-refresh consent was recorded.`;
}

function uniqueManageUrl(items: readonly RelistRadarEmailItem[], fallback: string): string {
  return items.find((item) => clean(item.actionUrls.manage))?.actionUrls.manage ?? fallback;
}

export function buildRelistRadarEmail({
  kind,
  propertyAddress,
  propertyId,
  appUrl,
  items,
  locale,
}: {
  kind: RelistRadarEmailKind;
  propertyAddress: string;
  propertyId: string;
  appUrl: string;
  items: readonly RelistRadarEmailItem[];
  locale?: RelistRadarEmailLocale | null;
}): RelistRadarBuiltEmail {
  const lang = localeOf(locale);
  const dashboardUrl = uniqueManageUrl(
    items,
    relistRadarManageUrl(appUrl, propertyId),
  );
  const safeAddress = clean(propertyAddress) ?? "this property";
  const activeItems = items.filter((item) => clean(item.channelLabel));
  const count = activeItems.length;

  const detailsText = activeItems
    .map((item) =>
      kind === "last_chance"
        ? lastChanceLine(item, lang)
        : kind === "paid_lapse"
          ? paidLapseLine(item, lang)
          : noticeLine(item, lang),
    )
    .join("\n");

  const actions: RelistRadarEmailButton[] = [];
  if (kind === "notice") {
    for (const item of activeItems) {
      const url = item.paid
        ? actionUrl(item.actionUrls.consent)
        : actionUrl(item.actionUrls.skip);
      if (!url) continue;
      actions.push({
        label: item.paid
          ? lang === "fr"
            ? `Rafraichir pour ${feeLabel(item, lang)}`
            : `Refresh for ${feeLabel(item, lang)}`
          : lang === "fr"
            ? `Ignorer ${item.channelLabel}`
            : `Skip ${item.channelLabel}`,
        url,
        variant: item.paid ? "primary" : "secondary",
      });
    }
  } else if (kind === "last_chance") {
    for (const item of activeItems) {
      const keepLive = actionUrl(item.actionUrls.keepLive);
      const letExpire = actionUrl(item.actionUrls.letExpire);
      if (keepLive) {
        actions.push({
          label: lang === "fr" ? `Garder ${item.channelLabel}` : `Keep ${item.channelLabel} live`,
          url: keepLive,
          variant: "primary",
        });
      }
      if (letExpire) {
        actions.push({
          label: lang === "fr" ? `Laisser ${item.channelLabel} expirer` : `Let ${item.channelLabel} expire`,
          url: letExpire,
          variant: "secondary",
        });
      }
    }
  } else if (kind === "paid_lapse") {
    for (const item of activeItems) {
      const consent = actionUrl(item.actionUrls.consent);
      if (!consent) continue;
      actions.push({
        label:
          lang === "fr"
            ? `Rafraichir pour ${feeLabel(item, lang)}`
            : `Refresh for ${feeLabel(item, lang)}`,
        url: consent,
        variant: "primary",
      });
    }
  }
  actions.push({
    label: lang === "fr" ? "Gerer dans Distribute" : "Manage in Distribute",
    url: dashboardUrl,
    variant: "secondary",
  });

  const summaryText =
    lang === "fr"
      ? kind === "last_chance"
        ? `Dernier rappel pour ${count} ${plural(count, "annonce", "annonces")} ignoree(s) de ${safeAddress}.`
        : kind === "paid_lapse"
          ? `Aucun consentement payant n'a ete enregistre pour ${count} ${plural(
              count,
              "annonce",
              "annonces",
            )} de ${safeAddress}.`
          : `Relist Radar a trouve ${count} ${plural(
              count,
              "annonce",
              "annonces",
            )} pres de l'expiration pour ${safeAddress}.`
      : kind === "last_chance"
        ? `Last chance for ${count} skipped ${plural(count, "ad", "ads")} at ${safeAddress}.`
        : kind === "paid_lapse"
          ? `No paid-refresh consent was recorded for ${count} ${plural(
              count,
              "ad",
              "ads",
            )} at ${safeAddress}.`
          : `Relist Radar found ${count} ${plural(
              count,
              "ad",
              "ads",
            )} nearing expiry at ${safeAddress}.`;

  const safetyNote =
    lang === "fr"
      ? "Decision seulement: ces liens enregistrent votre choix. Vacantless ne facture pas, ne republie pas, ne modifie pas et ne soumet rien depuis ce courriel dans ce deploiement."
      : "Decision only: these links record what you want to happen. Vacantless will not charge, repost, edit, or submit anything from this email in this rollout.";

  const manageLine =
    lang === "fr"
      ? `Gerer la fiche dans Distribute: ${dashboardUrl}`
      : `Manage this listing in Distribute: ${dashboardUrl}`;

  const subject =
    lang === "fr"
      ? kind === "last_chance"
        ? `Dernier rappel: ${safeAddress}`
        : kind === "paid_lapse"
          ? `Annonce payante expiree: ${safeAddress}`
          : `Rafraichir les annonces: ${safeAddress}`
      : kind === "last_chance"
        ? `Last chance: ${safeAddress}`
        : kind === "paid_lapse"
          ? `Paid listing expired: ${safeAddress}`
          : `Refresh listing ads: ${safeAddress}`;

  const body = [summaryText, detailsText, safetyNote, manageLine]
    .filter((part) => part.trim())
    .join("\n\n");

  return { subject, body, dashboardUrl, summaryText, detailsText, actions };
}

export function buildRelistRadarAutopilotRecap({
  appUrl,
  monthLabel,
  items,
}: {
  appUrl: string;
  monthLabel: string;
  items: readonly RelistRadarAutopilotRecapItem[];
}): RelistRadarBuiltEmail {
  const count = items.length;
  const dashboardUrl =
    items.find((item) => clean(item.dashboardUrl))?.dashboardUrl ??
    `${appUrl.replace(/\/+$/, "")}/dashboard/leasing`;
  const detailsText = items
    .map((item) => {
      const date = dateLabel(item.cycleDate, "en");
      return `- ${item.channelLabel} at ${item.propertyAddress} reached its refresh date on ${date}.`;
    })
    .join("\n");
  const summaryText = `Relist Radar queued ${count} free ${plural(
    count,
    "refresh",
    "refreshes",
  )} in ${monthLabel}.`;
  const safetyNote =
    "No paid listings were refreshed. Successful worker posts still wait for live-link confirmation before Vacantless marks a channel Live.";
  const body = [summaryText, detailsText, safetyNote, `Open Distribute: ${dashboardUrl}`]
    .filter((part) => part.trim())
    .join("\n\n");
  return {
    subject: `Relist Radar monthly recap: ${monthLabel}`,
    body,
    dashboardUrl,
    summaryText,
    detailsText,
    actions: [
      {
        label: "Open Distribute",
        url: dashboardUrl,
        variant: "primary",
      },
    ],
  };
}

export function addDaysISO(nowISO: string, days: number): string | null {
  const time = parseTime(nowISO);
  if (time == null || !Number.isFinite(days)) return null;
  return new Date(time + Math.trunc(days) * 86_400_000).toISOString();
}

export function relistRadarCycleDate(expiresAt: string | null | undefined): string | null {
  const time = parseTime(expiresAt);
  if (time == null) return null;
  return new Date(time).toISOString().slice(0, 10);
}

export function daysToExpiry({
  nowISO,
  externalExpiresAt,
}: {
  nowISO: string;
  externalExpiresAt: string | null | undefined;
}): number | null {
  const now = parseTime(nowISO);
  const expires = parseTime(externalExpiresAt);
  if (now == null || expires == null) return null;
  return Math.ceil((expires - now) / 86_400_000);
}

export function buildRelistRadarClockUpdate({
  enabled,
  channel,
  nowISO,
  existingExternalPostedAt,
  existingExternalUrl,
  nextExternalUrl,
}: {
  enabled: boolean;
  channel: string | null | undefined;
  nowISO: string;
  existingExternalPostedAt: string | null | undefined;
  existingExternalUrl: string | null | undefined;
  nextExternalUrl: string | null | undefined;
}): RelistRadarClockUpdate {
  if (!enabled) return {};
  const channelMeta = channelByKey(channel);
  const liveUrl = clean(nextExternalUrl);
  if (!channelMeta || !liveUrl) return {};

  const priorPostedAt = clean(existingExternalPostedAt);
  const priorUrl = clean(existingExternalUrl);
  const freshPost = !priorPostedAt || priorUrl !== liveUrl;
  if (!freshPost) return {};

  return {
    external_posted_at: nowISO,
    external_expires_at:
      channelMeta.ttlDays == null ? null : addDaysISO(nowISO, channelMeta.ttlDays),
  };
}

export function classifyRelistRadarCandidate({
  nowISO,
  propertyStatus,
  externalExpiresAt,
  channelTtlDays,
  notifyLeadDays,
}: {
  nowISO: string;
  propertyStatus: string | null | undefined;
  externalExpiresAt: string | null | undefined;
  channelTtlDays: number | null | undefined;
  notifyLeadDays: number;
}): RelistRadarClassification {
  const status = clean(propertyStatus)?.toLowerCase() ?? null;
  if (status === "leased") {
    return { kind: "leased", daysToExpiry: null, cycleDate: null };
  }
  if (status !== "available") {
    return { kind: "not_available", daysToExpiry: null, cycleDate: null };
  }
  if (channelTtlDays == null) {
    return { kind: "unknown_ttl", daysToExpiry: null, cycleDate: null };
  }
  if (!clean(externalExpiresAt)) {
    return { kind: "missing_expiry", daysToExpiry: null, cycleDate: null };
  }

  const days = daysToExpiry({ nowISO, externalExpiresAt });
  const cycleDate = relistRadarCycleDate(externalExpiresAt);
  if (days == null || !cycleDate) {
    return { kind: "invalid_expiry", daysToExpiry: null, cycleDate: null };
  }
  if (days <= notifyLeadDays) {
    return { kind: "radar_candidate", daysToExpiry: days, cycleDate };
  }
  return { kind: "out_of_window", daysToExpiry: days, cycleDate };
}
