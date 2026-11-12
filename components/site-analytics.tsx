"use client";
// S784: Vercel Web Analytics, cookieless visit counts. Only our own public
// marketing pages are counted (isMarketingPath): renter, tenant and dashboard
// pages are dropped before anything is sent, so no booking or tenant link
// (which can carry a token) ever reaches analytics. Query strings are kept
// only for utm_ tags, so a page view records which campaign brought it.
import { Analytics } from "@vercel/analytics/next";
import { keepAnalyticsUrl } from "@/lib/site-analytics-url";

export function SiteAnalytics() {
  return (
    <Analytics
      beforeSend={(event) => {
        const url = keepAnalyticsUrl(event.url);
        return url ? { ...event, url } : null;
      }}
    />
  );
}
