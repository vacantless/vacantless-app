"use server";

import { revalidatePath } from "next/cache";
import { setUserLocale } from "@/lib/i18n/locale";

export async function setLocale(locale: string) {
  setUserLocale(locale);
  revalidatePath("/");
}
