// Which syndication channels a landlord is allowed to SEE, decided by what the
// product has actually done, not by what the catalog declares it can do.
//
// The catalog states intent. This module reads the record. Today the two
// disagree: the surface offers channels that have never produced a live ad, and
// it counts a `live` status written by an operator the same as one a machine
// confirmed by re-reading the public page. Those are different things and only
// the second is evidence.
//
// Pure, no I/O, so the rule can be tested rather than argued about.
//
// THREE STATES, ALL DERIVED:
//   proven    a machine re-read the public ad and found it, recently, by a route
//             that still exists. Safe to show, safe to sell.
//   assisted  it works, but a person did the posting or a person is the only one
//             who confirmed it. Show it, describe it as what it is, never call it
//             automatic.
//   unproven  no confirmed live ad by a surviving route, or none recently. NOT
//             SHOWN AT ALL. A greyed out tile is still advertising something we
//             cannot do.
//
// ONE RULE ABOUT TEST ORGANIZATIONS, APPLIED TO BOTH INPUTS. Work done inside an
// organization we own proves the mechanism and never the channel. The first
// version of this module excluded test organizations from live posts and forgot
// them on verifications, which promoted Kijiji to "proven" on three checks that
// all happened inside Growth Test. The exclusion now runs through a single
// predicate that both inputs pass through, so it cannot be applied to one and
// forgotten on the other. The caller passes the ids; nothing here guesses from a
// name, because the name guess in the first draft caught "Growth Test" and
// missed "North Star Rentals QA".

export type ChannelProvenness = "proven" | "assisted" | "unproven";

/**
 * A transport whose code has been removed. A win by a route that no longer
 * exists cannot make a channel proven today: nobody can repeat it. This is what
 * demotes Kijiji and Facebook Marketplace honestly after the S695 cut.
 */
export const RETIRED_TRANSPORTS = ["browser_copilot"] as const;

/** Default decay. A channel that has placed nothing in a quarter is not one to sell. */
export const DEFAULT_FRESHNESS_DAYS = 90;

/**
 * Verification types a MACHINE performs by fetching the page. Anything else is a
 * person's word, which is evidence of a different weight.
 */
export const MACHINE_VERIFICATION_TYPES = ["public_page", "external_url", "feed_render"] as const;

/** The only result that means "the ad was there when we looked". */
export const LIVE_RESULT = "verified_live";

export type ChannelVerificationRow = {
  channel: string;
  /** "verified_live" | "verified_submitted" | "stale" | ... */
  result: string;
  /** "public_page" | "external_url" | "manual_concierge" | "feed_render" */
  verificationType: string;
  /** Null when a machine did it; a user id when a person did. */
  checkedBy: string | null;
  /** "YYYY-MM-DD" */
  checkedOn: string;
  /** The transport of the run item behind it, when known. */
  transport: string | null;
  /** Null counts as non production: a check we cannot attribute is not evidence. */
  organizationId: string | null;
};

export type ChannelLivePostRow = {
  channel: string;
  /** Null counts as non production, same as on a verification. */
  organizationId: string | null;
  hasUrl: boolean;
};

export type ChannelEvidence = {
  channel: string;
  provenness: ChannelProvenness;
  /** Ads a status column says are live right now, in real orgs. */
  adsLiveNow: number;
  /** Distinct real organizations with a live ad. Breadth, not just volume. */
  orgsWithLiveAds: number;
  /** Confirmed live by a machine re-reading the page, fresh, surviving route. */
  machineVerifications: number;
  /** Confirmed live by a person. */
  humanVerifications: number;
  lastVerifiedOn: string | null;
  /** One plain sentence, for the internal view and for the sales claim. */
  reason: string;
};

export type ProvennessInput = {
  verifications: ChannelVerificationRow[];
  livePosts: ChannelLivePostRow[];
  /** "YYYY-MM-DD" */
  asOf: string;
  freshnessDays?: number;
  retiredTransports?: readonly string[];
  /** Organizations we run ourselves. Their rows prove nothing, on either input. */
  testOrganizationIds?: readonly string[];
};

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return Math.round((b - a) / 86400000);
}

/**
 * The single test organization gate. Both inputs pass through this, which is the
 * whole point: a channel cannot be promoted by work we did on ourselves.
 */
export function isProductionOrg(
  organizationId: string | null | undefined,
  testOrganizationIds: ReadonlySet<string>,
): boolean {
  if (organizationId == null) return false;
  return !testOrganizationIds.has(organizationId);
}

function isMachine(row: ChannelVerificationRow): boolean {
  return (
    row.checkedBy == null &&
    (MACHINE_VERIFICATION_TYPES as readonly string[]).includes(row.verificationType)
  );
}

/**
 * Every channel mentioned by either input, with its record and its verdict.
 * Channels are returned sorted strongest first, so a caller can take the head.
 */
export function channelEvidence(input: ProvennessInput): ChannelEvidence[] {
  const {
    verifications,
    livePosts,
    asOf,
    freshnessDays = DEFAULT_FRESHNESS_DAYS,
    retiredTransports = RETIRED_TRANSPORTS,
    testOrganizationIds = [],
  } = input;
  const retired = new Set(retiredTransports);
  const testOrgs = new Set(testOrganizationIds);

  const channels = new Set<string>([
    ...verifications.map((v) => v.channel),
    ...livePosts.map((p) => p.channel),
  ]);

  const out: ChannelEvidence[] = [];
  for (const channel of channels) {
    // A live ad only counts from a real organization. A win in a test org proves
    // the mechanism, never the channel.
    const live = livePosts.filter(
      (p) => p.channel === channel && p.hasUrl && isProductionOrg(p.organizationId, testOrgs),
    );
    const adsLiveNow = live.length;
    const orgsWithLiveAds = new Set(live.map((p) => p.organizationId as string)).size;

    // Only confirmations that mean live, by a surviving route, inside the window.
    const usable = verifications.filter(
      (v) =>
        v.channel === channel &&
        v.result === LIVE_RESULT &&
        isProductionOrg(v.organizationId, testOrgs) &&
        !(v.transport != null && retired.has(v.transport)) &&
        daysBetween(v.checkedOn, asOf) <= freshnessDays &&
        daysBetween(v.checkedOn, asOf) >= 0,
    );
    const machineVerifications = usable.filter(isMachine).length;
    const humanVerifications = usable.length - machineVerifications;
    const lastVerifiedOn = usable
      .map((v) => v.checkedOn)
      .sort()
      .at(-1) ?? null;

    let provenness: ChannelProvenness;
    let reason: string;
    if (machineVerifications > 0) {
      provenness = "proven";
      reason = `Confirmed live ${machineVerifications} time${machineVerifications === 1 ? "" : "s"} by re-reading the ad, most recently ${lastVerifiedOn}.`;
    } else if (humanVerifications > 0) {
      provenness = "assisted";
      reason = `Confirmed live by a person ${humanVerifications} time${humanVerifications === 1 ? "" : "s"}, most recently ${lastVerifiedOn}. No machine check yet.`;
    } else {
      provenness = "unproven";
      const everLive = verifications.filter(
        (v) =>
          v.channel === channel &&
          v.result === LIVE_RESULT &&
          isProductionOrg(v.organizationId, testOrgs),
      );
      // "Retired only" must mean EVERY win came by a dead route. If any win came
      // by a surviving one, the channel is stale rather than unrepeatable, and
      // saying otherwise sends the reader to fix the wrong thing.
      const retiredOnly =
        everLive.length > 0 &&
        everLive.every((v) => v.transport != null && retired.has(v.transport));
      const stale = everLive.length > 0;
      const testOnly =
        everLive.length === 0 &&
        verifications.some(
          (v) =>
            v.channel === channel &&
            v.result === LIVE_RESULT &&
            !isProductionOrg(v.organizationId, testOrgs),
        );
      reason = retiredOnly
        ? "The only confirmed posts came by a route that has since been removed, so nobody can repeat them."
        : stale
          ? `Nothing confirmed live in the last ${freshnessDays} days.`
          : testOnly
            ? "Only ever confirmed live in an account we run ourselves, which proves the mechanism and not the channel."
            : "No confirmed live ad, ever.";
    }

    out.push({
      channel,
      provenness,
      adsLiveNow,
      orgsWithLiveAds,
      machineVerifications,
      humanVerifications,
      lastVerifiedOn,
      reason,
    });
  }

  const rank: Record<ChannelProvenness, number> = { proven: 0, assisted: 1, unproven: 2 };
  return out.sort(
    (a, b) =>
      rank[a.provenness] - rank[b.provenness] ||
      b.machineVerifications - a.machineVerifications ||
      b.adsLiveNow - a.adsLiveNow ||
      a.channel.localeCompare(b.channel),
  );
}

/**
 * SHOW_ONLY_PROVEN_CHANNELS. Dark by default, because turning it on removes
 * Facebook rows from a landlord surface and the Meta App Review verdict is
 * outstanding until 2026-09-22. With the flag off the surface renders exactly
 * as it does today; with it on, the filter applies. Accepts 1/true/yes like
 * every other env flag in this codebase.
 */
export function showOnlyProvenChannelsEnabled(
  value: string | null | undefined = process.env.SHOW_ONLY_PROVEN_CHANNELS,
): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Organizations we run ourselves. Their rows prove the mechanism and never the
 * channel, so they are excluded from BOTH inputs. Listed by id rather than
 * matched on a name: the name guess this module started with caught "Growth
 * Test" and missed "North Star Rentals QA", which is how three Kijiji checks
 * inside our own account nearly shipped as "posted and checked by us".
 */
export const NON_PRODUCTION_ORGANIZATION_IDS = [
  // Growth Test
  "8ea1da48-0cd2-45a4-bfba-023b31a67884",
  // North Star Rentals QA
  "b733a191-30fd-47fe-bd21-731404148026",
  // S696f: four more of ours, found by enumerating organizations rather than
  // by waiting for one of them to produce a row. All four hold ZERO
  // verifications and ZERO live posts today [verified 2026-09-11 via SQL], so
  // adding them changes no current verdict. That is the point: the list has to
  // be right BEFORE one of them posts, not after. The first version of this
  // module shipped with two ids and called our own QA work a customer win.
  "5853b472-7121-4374-bbf0-c2115cef05a5", // Smoke Test Realty S167
  "569e23f6-2929-4e78-abd0-546c1dcbb3c7", // Premium Test
  "606a2cc4-cbd8-44c9-987c-36e392c92bca", // Org A
  "50b496d5-0e17-4756-be1a-559d2a9c9d78", // Org B
  // NOT LISTED, AND IT IS A REAL QUESTION: Maple Door Rentals
  // (a0e2e45c-f2be-427e-b8db-30535a821daa), plan `pilot`, 3 properties, 6
  // leads. It reads like a real pilot customer, and excluding a real customer
  // suppresses true evidence, so it is left counting as production. It holds no
  // verifications and no live posts either, so nothing turns on it today. Ask
  // Noam before moving it.
] as const;

/** The channel keys a landlord may see. Unproven channels are simply absent. */
export function shownChannels(evidence: ChannelEvidence[]): string[] {
  return evidence.filter((e) => e.provenness !== "unproven").map((e) => e.channel);
}

/**
 * How a shown channel is described. Never "automatic" unless a machine both
 * posted and confirmed it; the landlord is told who does the work.
 */
export function channelPostedByLabel(e: ChannelEvidence): string {
  if (e.provenness === "proven") return "Posted and checked by us";
  if (e.provenness === "assisted") return "Posted by us, checked by hand";
  return "Not offered";
}
