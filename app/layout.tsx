import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { adTagConfig, adTagsOn } from "@/lib/ad-conversions";
import { MarketingTags } from "@/components/ad-tags";

export const metadata: Metadata = {
  title: "Vacantless",
  description: "Rental leasing software for landlords and property managers.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();
  // S723: ad tags on marketing pages only, and only once configured.
  const adCfg = adTagConfig(process.env);

  return (
    <html lang={locale}>
      <body className="min-h-screen">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
        {adTagsOn(adCfg) && <MarketingTags cfg={adCfg} />}
      </body>
    </html>
  );
}
