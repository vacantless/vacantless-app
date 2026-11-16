"use client";

import { useEffect, useState } from "react";
import { facebookRenewHref, FACEBOOK_YOUR_LISTINGS } from "@/lib/facebook-renew";
import { isPhoneUserAgent } from "@/lib/sites-phone";

// S805: "Check Renew on Marketplace". On a computer it opens Your listings,
// where Facebook keeps Renew in each ad's "..." menu. On a phone that address
// opens the Facebook app's Marketplace search with "No results found" (seen on
// Noam's iPhone 2026-11-16), so on a phone it opens the ad itself, which offers
// the Facebook app. With no ad link on a phone it renders nothing.
export function FacebookRenewLink({
  adUrl = null,
  className,
  children,
}: {
  adUrl?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  const [onPhone, setOnPhone] = useState(false);
  useEffect(() => {
    setOnPhone(isPhoneUserAgent(typeof navigator === "undefined" ? "" : navigator.userAgent));
  }, []);
  const href = onPhone ? facebookRenewHref(adUrl, true) : FACEBOOK_YOUR_LISTINGS;
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}
