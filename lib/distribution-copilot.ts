// ============================================================================
// Pure BROWSER CO-PILOT script model (S482, first-class distribution). No DOM /
// env / IO — unit-tested (scripts/test-distribution-copilot.ts).
//
// The honest "browser_copilot" transport (S480 capability matrix): Facebook,
// Kijiji, and Viewit have no supported long-term-rental posting API and their
// ToS forbid silent automation, so Vacantless CANNOT post to them for the
// operator. What it CAN do is act as a co-pilot: prepare channel-fit copy + the
// tracked inquiry link, hand the operator a step-by-step script, and STOP at
// every human gate (login, payment, CAPTCHA, final review). The operator posts,
// then pastes the live ad URL as proof — only then is the channel marked live.
//
// This file owns the PURE script: which fields to copy, the ordered steps, and
// which steps are hard human stop-gates. The server action (completeCopilotPost)
// enforces "never live without a real URL"; canMarkCopilotLive is the pure guard
// it reuses so the rule is testable in isolation.
// ============================================================================

import { channelCapability } from "./distribution-capabilities";
import { channelByKey } from "./distribution-channels";
import {
  publishModeLabel,
  type PublishChannelKey,
  type PublishMode,
} from "./distribution-publish";
import {
  buildListingCopy,
  formatRent,
  normalizeCopyPortal,
  type ListingCopyInput,
} from "./listing-copy";
import { isWebUrl } from "./listing-distribution";

// --- stop gates -------------------------------------------------------------
// A hard human gate the co-pilot NEVER crosses on the operator's behalf.
export const COPILOT_STOP_GATES = [
  "login",
  "payment",
  "captcha",
  "final_review",
] as const;
export type CopilotStopGate = (typeof COPILOT_STOP_GATES)[number];

const STOP_GATE_LABELS: Record<CopilotStopGate, string> = {
  login: "You sign in",
  payment: "You pay",
  captcha: "You clear the security check",
  final_review: "You review and post",
};

export function stopGateLabel(g: unknown): string {
  return typeof g === "string" &&
    (COPILOT_STOP_GATES as readonly string[]).includes(g)
    ? STOP_GATE_LABELS[g as CopilotStopGate]
    : "";
}

export function stopGateNote(g: CopilotStopGate, channelLabel: string): string {
  switch (g) {
    case "login":
      return `Sign in to ${channelLabel} yourself — Vacantless never stores or enters your login.`;
    case "payment":
      return `Complete any paid placement on ${channelLabel} yourself — Vacantless never enters payment details.`;
    case "captcha":
      return `If ${channelLabel} shows a CAPTCHA or security check, you clear it — Vacantless can't and won't.`;
    case "final_review":
      return `Review the ad, then click ${channelLabel}'s own Post/Publish button. Vacantless never clicks it for you.`;
  }
}

// --- fields -----------------------------------------------------------------
export type CopilotFieldKey =
  | "title"
  | "body"
  | "price"
  | "address"
  | "tracked_link";

export type CopilotField = {
  key: CopilotFieldKey;
  label: string;
  value: string;
  multiline: boolean;
  hint?: string;
};

// --- steps ------------------------------------------------------------------
export type CopilotStep = {
  key: string;
  label: string;
  detail?: string;
  // When set, this step is a hard human gate — the co-pilot stops here.
  stopGate?: CopilotStopGate;
};

// --- script -----------------------------------------------------------------
export type CopilotScript = {
  channel: PublishChannelKey;
  channelLabel: string;
  transport: PublishMode;
  transportLabel: string;
  portalUrl: string | null;
  fields: CopilotField[];
  steps: CopilotStep[];
  stopGates: CopilotStopGate[];
  honesty: string[];
  // Requirements to clear before this channel can carry a working tracked link
  // (e.g. the public page must be live). Surfaced, not blocking the co-pilot.
  blockers: string[];
  // Invariant surfaced to the UI: completion REQUIRES a live URL as proof.
  requiresLiveUrlToComplete: true;
};

export type CopilotScriptInput = {
  channel: PublishChannelKey;
  copy: ListingCopyInput;
  trackedUrl: string | null;
  publicPageLive: boolean;
};

/** Only the honest browser_copilot channels get a co-pilot script. Pure. */
export function isCopilotChannel(channel: PublishChannelKey): boolean {
  return channelCapability(channel).transport === "browser_copilot";
}

/**
 * Build the guided co-pilot script for a browser_copilot channel, or null when
 * the channel isn't co-pilot-eligible (automatic / feed / broker / custom). Pure.
 */
export function buildCopilotScript(
  input: CopilotScriptInput,
): CopilotScript | null {
  const { channel } = input;
  const cap = channelCapability(channel);
  if (cap.transport !== "browser_copilot") return null;

  const channelMeta = channelByKey(channel);
  const channelLabel = channelMeta?.label ?? channel;
  const portalUrl = channelMeta?.portalUrl ?? null;

  // Channel-fit copy (title length-capped + body). facebook/kijiji/viewit are all
  // valid copy portals; normalize keeps this total for an unexpected key. The
  // tracked link is threaded in as the public URL so the CTA points renters at
  // the attributed inquiry link.
  const copyPortal = normalizeCopyPortal(channel);
  const listing = buildListingCopy(
    {
      ...input.copy,
      publicUrl: input.trackedUrl ?? input.copy.publicUrl ?? null,
    },
    copyPortal,
  );

  const fields: CopilotField[] = [];
  if (listing.title) {
    fields.push({
      key: "title",
      label: "Title",
      value: listing.title,
      multiline: false,
    });
  }
  if (listing.body) {
    fields.push({
      key: "body",
      label: "Description",
      value: listing.body,
      multiline: true,
    });
  }
  const rent = formatRent(input.copy.rentCents);
  if (rent) {
    fields.push({
      key: "price",
      label: "Monthly rent",
      value: rent,
      multiline: false,
    });
  }
  const address = (input.copy.address ?? "").trim();
  if (address) {
    fields.push({
      key: "address",
      label: "Address",
      value: address,
      multiline: false,
    });
  }
  if (input.trackedUrl) {
    fields.push({
      key: "tracked_link",
      label: "Tracked inquiry link",
      value: input.trackedUrl,
      multiline: false,
      hint: "Renters use this to reach your booking page; per-channel attribution starts when you mark it live.",
    });
  }

  // Stop gates: which human gates apply to this channel.
  const stopGates: CopilotStopGate[] = [];
  if (cap.requiresLogin) stopGates.push("login");
  if (cap.requiresPayment) stopGates.push("payment");
  // Every self-serve portal can throw a CAPTCHA / security check; be honest.
  stopGates.push("captcha");
  stopGates.push("final_review");

  // Ordered steps. login / payment / final_review are numbered stop-gate steps;
  // CAPTCHA is unpredictable (may appear at login OR post) so it rides as an
  // honesty note + a stopGates flag, not a fixed step.
  const steps: CopilotStep[] = [];
  steps.push({
    key: "open",
    label: `Open ${channelLabel} in a new tab`,
    detail: "Vacantless opens the posting page; it does not post for you.",
  });
  if (cap.requiresLogin) {
    steps.push({
      key: "login",
      label: `Sign in to ${channelLabel}`,
      detail: stopGateNote("login", channelLabel),
      stopGate: "login",
    });
  }
  steps.push({
    key: "title",
    label: "Copy the title into the portal",
    detail: "Already length-fit for this channel.",
  });
  steps.push({ key: "body", label: "Copy the description into the portal" });
  steps.push({
    key: "fields_photos",
    label: "Fill the remaining fields and upload the photos in order",
    detail:
      channel === "facebook"
        ? "Facebook flags duplicate photos across posts — use this listing's own set, cover photo first."
        : "Use the field sheet in Photos & listing copy; cover photo first.",
  });
  if (cap.requiresPayment) {
    steps.push({
      key: "payment",
      label: `Complete the paid placement on ${channelLabel}`,
      detail: stopGateNote("payment", channelLabel),
      stopGate: "payment",
    });
  }
  steps.push({
    key: "review",
    label: "Review the ad and post it yourself",
    detail: stopGateNote("final_review", channelLabel),
    stopGate: "final_review",
  });
  steps.push({
    key: "paste_url",
    label: "Paste the live ad URL below and mark it live",
    detail:
      "Saves proof and turns on the tracked inquiry link. Nothing is marked live without it.",
  });

  const honesty: string[] = [];
  honesty.push(
    "Vacantless prepares the copy and guides each step — you do the actual posting.",
  );
  if (cap.requiresLogin) honesty.push(stopGateNote("login", channelLabel));
  if (cap.requiresPayment) honesty.push(stopGateNote("payment", channelLabel));
  honesty.push(stopGateNote("captcha", channelLabel));
  honesty.push(
    "Nothing is marked live until you paste the live ad URL as proof.",
  );

  const blockers: string[] = [];
  if (!input.publicPageLive || !input.trackedUrl) {
    blockers.push(
      "Set the Vacantless public page Live first so the tracked inquiry link works.",
    );
  }

  return {
    channel,
    channelLabel,
    transport: cap.transport,
    transportLabel: publishModeLabel(cap.transport),
    portalUrl,
    fields,
    steps,
    stopGates,
    honesty,
    blockers,
    requiresLiveUrlToComplete: true,
  };
}

// Per-channel host allowlist for the browser co-pilot channels. A co-pilot post's
// live-proof URL must live on the channel the operator actually posted to.
const COPILOT_CHANNEL_HOSTS: Record<string, string[]> = {
  kijiji: ["kijiji.ca"],
  facebook: ["facebook.com"],
  viewit: ["viewit.ca"],
};

// POSITIVE per-channel "this is a public listing" path shapes. The server gate is
// an ALLOWLIST (accept only a real listing URL), NOT a denylist — a denylist lets a
// bare root / browse page (kijiji.ca/, facebook.com/marketplace/, viewit.ca/) slip
// through as "ok" and mark live without proof (Codex S485 P2). The extension's
// portal.js keeps a soft BAD_PATH warn to hint the operator; THIS is the
// authoritative hard gate and is intentionally stricter. A public listing on each
// portal carries a numeric listing id:
//   kijiji   /v-<category>/<...>/<numeric ad id>   (VIP ad page; the /v- prefix +
//            trailing id, so a /b- or /s- browse page or a title slug that merely
//            starts with b-/s- in a later segment is not confused for a listing)
//   facebook /marketplace/item/<numeric item id>
//   viewit   a numeric listing id — either its own path segment (/26049) OR the
//            slug form ending VIT=<id> / VIT%3D<id> (pathname keeps %3D encoded),
//            e.g. /3015SandwichSt-Windsor-1bdrm-VIT=22134 (Codex S485b re-review).
const COPILOT_LISTING_PATH: Record<string, RegExp> = {
  kijiji: /^\/v-.+\/\d{6,}\/?$/i,
  facebook: /\/marketplace\/item\/\d{6,}(?:\/|$)/i,
  viewit: /\/\d{5,}(?:\/|$)|VIT(?:=|%3D)\d{5,}/i,
};

function copilotHostMatches(host: string, base: string): boolean {
  return host === base || host.endsWith("." + base);
}

export type CopilotLiveUrlIssue = "ok" | "invalid" | "wrong_channel" | "not_listing";

/**
 * Classify a co-pilot live-proof URL for a channel. Pure. Returns "ok" ONLY for a
 * real http(s) URL that is (a) on the channel's own host and (b) shaped like that
 * channel's PUBLIC LISTING (a positive allowlist — a root / browse / login /
 * search page has no listing id and is rejected as "not_listing"). This is the
 * server-side hardening that makes "mark live" require an actual public listing
 * URL as proof, not just any web URL on the right domain.
 */
export function copilotLiveUrlIssue(
  channel: string,
  externalUrl: string | null | undefined,
): CopilotLiveUrlIssue {
  if (!isWebUrl(externalUrl)) return "invalid";
  let u: URL;
  try {
    u = new URL(externalUrl as string);
  } catch {
    return "invalid";
  }
  const hosts = COPILOT_CHANNEL_HOSTS[channel];
  const listing = COPILOT_LISTING_PATH[channel];
  if (!hosts || !listing) return "invalid"; // not a browser co-pilot channel
  const host = u.hostname.toLowerCase();
  if (!hosts.some((base) => copilotHostMatches(host, base))) return "wrong_channel";
  if (!listing.test(u.pathname)) return "not_listing";
  return "ok";
}

/**
 * The pure guard the completion server action reuses: a co-pilot post may be
 * marked live ONLY with a real, channel-matching public-listing URL as proof.
 * Never live without proof; never live from a browse / login / search page.
 */
export function canMarkCopilotLive(
  channel: string,
  externalUrl: string | null | undefined,
): boolean {
  return copilotLiveUrlIssue(channel, externalUrl) === "ok";
}
