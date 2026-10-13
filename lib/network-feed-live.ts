// Is any partner able to take the aggregator feed right now? (S712 honest claims)
//
// The feed route (app/api/feed/network/route.ts) refuses every request unless
// NETWORK_FEED_TOKEN is set, and the publish lane only offers the network feed
// under the same gate. A rental that passes feedSignal readiness is therefore
// NOT "sent to partner sites" unless this is also true.
export function networkFeedLive(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env.NETWORK_FEED_TOKEN?.trim());
}
