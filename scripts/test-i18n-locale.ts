import { readFileSync } from "node:fs";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  SUPPORTED_LOCALES,
  assertSupportedLocale,
  isSupportedLocale,
  localeFromCookieValue,
} from "../lib/i18n/locale";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

function loadMessages(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Record<string, unknown>;
}

ok("default locale is English", DEFAULT_LOCALE === "en");
ok("locale cookie is NEXT_LOCALE", LOCALE_COOKIE_NAME === "NEXT_LOCALE");
ok("supported locale list is en/fr", SUPPORTED_LOCALES.join("|") === "en|fr");
ok("en is supported", isSupportedLocale("en"));
ok("fr is supported", isSupportedLocale("fr"));
ok("junk locale is unsupported", !isSupportedLocale("es"));
ok("cookie en resolves en", localeFromCookieValue("en") === "en");
ok("cookie fr resolves fr", localeFromCookieValue("fr") === "fr");
ok("missing cookie falls back to en", localeFromCookieValue(undefined) === "en");
ok("unsupported cookie falls back to en", localeFromCookieValue("es") === "en");
ok("assertSupportedLocale returns supported locale", assertSupportedLocale("fr") === "fr");

try {
  assertSupportedLocale("es");
  ok("assertSupportedLocale rejects unsupported locale", false);
} catch {
  ok("assertSupportedLocale rejects unsupported locale", true);
}

const enMessages = loadMessages("en");
const frMessages = loadMessages("fr");
ok(
  "message catalogs have matching top-level keys",
  Object.keys(enMessages).sort().join("|") === Object.keys(frMessages).sort().join("|"),
);
ok("message catalog contains command-center stage keys", Boolean(enMessages.stage1 && enMessages.stage4));

console.log(`\ni18n-locale: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
