import { getRequestConfig } from "next-intl/server";
import { getUserLocale, type AppLocale } from "@/lib/i18n/locale";

const messageLoaders: Record<AppLocale, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import("../messages/en.json"),
  fr: () => import("../messages/fr.json"),
};

export default getRequestConfig(async () => {
  const locale = getUserLocale();
  const messages = (await messageLoaders[locale]()).default;

  return {
    locale,
    messages,
  };
});
