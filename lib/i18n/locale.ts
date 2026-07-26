import { cookies } from "next/headers";

export const SUPPORTED_LOCALES = ["en", "fr"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

export function isSupportedLocale(value: unknown): value is AppLocale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

export function localeFromCookieValue(value: unknown): AppLocale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

export function assertSupportedLocale(value: unknown): AppLocale {
  if (isSupportedLocale(value)) return value;
  throw new Error(`Unsupported locale: ${String(value)}`);
}

export function getUserLocale(): AppLocale {
  return localeFromCookieValue(cookies().get(LOCALE_COOKIE_NAME)?.value);
}

export function setUserLocale(locale: unknown): AppLocale {
  const nextLocale = assertSupportedLocale(locale);
  cookies().set(LOCALE_COOKIE_NAME, nextLocale, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return nextLocale;
}
