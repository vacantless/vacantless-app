"use server";

import { revalidatePath } from "next/cache";
import { setUserLocale } from "@/lib/i18n/locale";

export async function setLocale(locale: string) {
  setUserLocale(locale);
  revalidatePath("/");
}

export async function setLocaleFromFormData(formData: FormData) {
  const locale = formData.get("locale");
  await setLocale(typeof locale === "string" ? locale : "");
}
